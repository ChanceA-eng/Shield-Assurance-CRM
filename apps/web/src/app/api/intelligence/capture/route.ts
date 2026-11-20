import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { approvedDiscoverySource, discoveryAccess } from '../../../../lib/discovery';
import { importMatches } from '../../../../lib/import-intelligence';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';
import { validEvidenceDate } from '@crm/shared';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    discoveryAccess(session.teamAccess);
    const body = await workspaceBody(request);
    if (!isUuid(body.source_id) || !isUuid(body.request_id) || body.rights_confirmed !== true
      || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 255
      || typeof body.selected_text !== 'string' || !body.selected_text.trim() || body.selected_text.length > 10000
      || typeof body.url !== 'string' || body.url.length > 2000
      || !validEvidenceDate(body.source_as_of) || body.source_as_of > new Date().toISOString().slice(0, 10)) throw new WorkspaceError('Select business text, name its source/date and confirm permitted use.', 400);
    let url: URL;
    try { url = new URL(body.url); } catch { throw new WorkspaceError('Use a valid public source URL.', 400); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new WorkspaceError('Use an HTTP(S) source URL without credentials, query tokens or fragments.', 400);
    for (const key of ['email', 'phone', 'address', 'line'] as const) {
      if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 500)) throw new WorkspaceError('Business contact fields must be text of at most 500 characters.', 400);
    }
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(body.email))) throw new WorkspaceError('Use a valid business email or leave it unknown.', 400);
    await approvedDiscoverySource(db, body.source_id);
    const profile = { kind: 'generic', capture: { url: url.href, selected_text: body.selected_text, source_as_of: body.source_as_of,
      evidence_class: 'vendor_reported', rights_confirmed: true } };
    const prospect = { full_name: body.name.trim(), email: typeof body.email === 'string' && body.email.trim() ? body.email.trim() : null,
      phone: typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null,
      address: typeof body.address === 'string' && body.address.trim() ? body.address.trim() : null, profile };
    const matches = await importMatches(db, [prospect], session.user.id);
    const fingerprint = createHash('sha256').update(JSON.stringify({ source: body.source_id, line: body.line || null, ...prospect })).digest('hex');
    const result = await db.rpc('acquire_discovery_file', { p_actor: session.user.id, p_source: body.source_id, p_request: body.request_id,
      p_fingerprint: fingerprint, p_file: `Selected business capture: ${body.name.trim()}`.slice(0, 255), p_vendor: 'generic', p_row_count: 1,
      p_prospects: [{ ...prospect, line_of_business: body.line || null, disposition: matches.has(0) ? 'duplicate' : 'pending',
        duplicate_of: matches.get(0)?.[0] ?? null, payload: { profile, raw: { source_url: url.href, source_as_of: body.source_as_of, selected_text: body.selected_text },
          duplicate_matches: matches.get(0) ?? [] } }] });
    if (result.error) throw databaseError(result.error);
    if (!isRecord(result.data) || !isUuid(result.data.batch_id)) throw new WorkspaceError('Capture status could not be verified. Retry the same capture.', 503);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (failure) { return workspaceApiError(failure, 'intelligence/capture'); }
}
