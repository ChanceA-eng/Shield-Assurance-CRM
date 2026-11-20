import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import type { PublicDiscoveryPage } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { approvedDiscoverySource, discoveryAccess } from '../../../../lib/discovery';
import { fmcsaGetCarrier, fmcsaSearchPage } from '../../../../lib/enrichment';
import { parseVendorDate } from '../../../../lib/lead-import';
import { importMatches } from '../../../../lib/import-intelligence';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    discoveryAccess(session.teamAccess);
    const params = request.nextUrl.searchParams;
    const source = params.get('source_id'), query = params.get('query')?.trim() ?? '', state = params.get('state')?.trim().toUpperCase() ?? '';
    const startText = params.get('start') ?? '0', start = Number(startText);
    if (!isUuid(source) || query.length < 2 || query.length > 60 || !/[a-z0-9]/i.test(query) || (state && !/^[A-Z]{2}$/.test(state))
      || !/^\d+$/.test(startText) || !Number.isSafeInteger(start) || start < 0 || start > 100000) {
      throw new WorkspaceError('Choose an approved FMCSA source, a business name of 2-60 characters and an optional two-letter state.', 400);
    }
    if ([...params.keys()].some((key) => !['source_id', 'query', 'state', 'start'].includes(key))) {
      throw new WorkspaceError('FMCSA supports business-name search and state filtering only. Other filters apply to saved prospects.', 400);
    }
    await approvedDiscoverySource(db, source, 'fmcsa');
    let result: Awaited<ReturnType<typeof fmcsaSearchPage>>;
    try { result = await fmcsaSearchPage(query, start); }
    catch (failure) { throw new WorkspaceError(failure instanceof Error ? failure.message : 'FMCSA search failed.', 503); }
    const page: PublicDiscoveryPage = {
      businesses: result.records.filter((record) => !state || record.physical_state?.toUpperCase() === state).map((record) => ({
        dot_number: record.dot_number, legal_name: record.legal_name, address: record.physical_address,
        state: record.physical_state ?? null, phone: record.phone ?? null, power_units: record.power_units, drivers: record.drivers,
        registration_reported_on: parseVendorDate(record.mcs150_date), operating_status: record.operating_status,
      })),
      next_start: result.next_start, fetched_at: new Date().toISOString(),
    };
    return NextResponse.json(page, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'discovery/public-search'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    discoveryAccess(session.teamAccess);
    const input = await workspaceBody(request);
    if (!isUuid(input.source_id) || !isUuid(input.request_id) || typeof input.dot_number !== 'string'
      || !/^[1-9]\d{0,8}$/.test(input.dot_number)) {
      throw new WorkspaceError('Choose a valid DOT business and acquisition identity.', 400);
    }
    await approvedDiscoverySource(db, input.source_id, 'fmcsa');
    const fingerprint = createHash('sha256').update(JSON.stringify({ source: input.source_id, provider: 'fmcsa', dot_number: input.dot_number })).digest('hex');
    const previous = await db.from('import_batches').select('id,discovery_source_id,discovery_fingerprint,prospect_count')
      .eq('discovery_request_id', input.request_id).maybeSingle();
    if (previous.error) throw databaseError(previous.error);
    if (previous.data) {
      if (previous.data.discovery_source_id !== input.source_id || previous.data.discovery_fingerprint !== fingerprint) {
        throw new WorkspaceError('This acquisition identity belongs to a different source or business.', 409);
      }
      return NextResponse.json({ batch_id: previous.data.id, prospect_count: previous.data.prospect_count, already_acquired: true });
    }
    let record: Awaited<ReturnType<typeof fmcsaGetCarrier>>;
    try { record = await fmcsaGetCarrier(input.dot_number); }
    catch (failure) { throw new WorkspaceError(failure instanceof Error ? failure.message : 'FMCSA business lookup failed.', 503); }
    if (record.dot_number !== input.dot_number || !record.legal_name.trim() || record.legal_name === 'Unknown') {
      throw new WorkspaceError('FMCSA did not return the selected business. Nothing was acquired.', 502);
    }
    record = { ...record, match_method: 'agent_selected_dot' };
    const profile = {
      kind: 'commercial', company: { name: record.legal_name, industry: 'DOT-registered motor carrier', state: record.physical_state ?? null },
      dot: { number: record.dot_number }, enrichment: { fmcsa: record },
      public_source: { provider: 'fmcsa', record_id: record.dot_number, evidence_class: 'public_record',
        registration_reported_on: parseVendorDate(record.mcs150_date), fetched_at: record.fetched_at,
        url: `https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${record.dot_number}` },
    };
    const prospect = { full_name: record.legal_name, email: null, phone: record.phone ?? null, address: record.physical_address, profile };
    const matches = await importMatches(db, [prospect], session.user.id);
    const saved = await db.rpc('acquire_discovery_file', {
      p_actor: session.user.id, p_source: input.source_id, p_request: input.request_id, p_fingerprint: fingerprint,
      p_file: `FMCSA DOT ${record.dot_number}`, p_vendor: 'commercial', p_row_count: 1,
      p_prospects: [{ ...prospect, line_of_business: null, disposition: matches.has(0) ? 'duplicate' : 'pending',
        duplicate_of: matches.get(0)?.[0] ?? null, payload: { profile, raw: [], duplicate_matches: matches.get(0) ?? [] } }],
    });
    if (saved.error) throw databaseError(saved.error);
    if (!isRecord(saved.data) || !isUuid(saved.data.batch_id) || saved.data.prospect_count !== 1 || typeof saved.data.already_acquired !== 'boolean') {
      throw new WorkspaceError('Acquisition could not be verified. Retry the same selected business.', 503);
    }
    return NextResponse.json(saved.data, { status: saved.data.already_acquired ? 200 : 201 });
  } catch (error) { return workspaceApiError(error, 'discovery/public-acquire'); }
}
