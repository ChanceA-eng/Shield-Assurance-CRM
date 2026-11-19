import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession, getApiSession, apiActorName } from '../../../lib/api-auth';
import { processLeadStatusChanged } from '../../../lib/automation';
import { ACTIVE_LEAD_STATUSES, normalizeLeadStatus } from '../../../lib/lead-pipeline';
import { scheduleIntakeTask, isWarmSource } from '../../../lib/intake-task';
import { applyResubmission } from '../../../lib/resubmission';
import { websiteSubmissionReceipts } from '../../../lib/website-receipts';
import { databaseError, workspaceBody, workspaceApiError, friendlyErrorMessage } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';
import { WorkspaceError } from '../../../lib/record-scope';
import { describeLeadArchive, parseLeadArchiveResults } from '../../../lib/lead-archive';
import { leadContactRestrictions } from '../../../lib/message-delivery';

interface NewLeadPayload {
  id?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  client_name?: string;
  phone?: string;
  email?: string;
  address?: string;
  zip?: string;
  state?: string;
  business?: string;
  primaryCoverage?: string;
  vehicleDetails?: string;
  details?: string;
  message?: string;
  bundles?: string | string[];
  line_of_business?: string;
  line?: string;
  insurance_line?: string;
  source?: string;
  status?: string;
  estimated_premium?: number | string;
}

function normalizeText(value: unknown): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed ? trimmed : null;
}

function normalizeStatus(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return 'new';
  return normalizeLeadStatus(normalized) ?? 'new';
}

function normalizeBundles(input: string | string[] | undefined): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => item.trim()).filter(Boolean);
  }

  if (typeof input === 'string') {
    return input
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function resolveAllowedOrigins(): string[] {
  const configured = (process.env.LEADS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(new Set(['https://www.shield-assurance.com', 'https://shield-assurance.com', ...configured]));
}

function corsHeaders(request: NextRequest): Record<string, string> {
  const requestOrigin = request.headers.get('origin') ?? '';
  const allowedOrigins = resolveAllowedOrigins();
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

function jsonWithCors(request: NextRequest, body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  const headers = corsHeaders(request);

  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }

  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get('actionableCount') === 'true') {
    const { data, error } = await supabase.rpc('get_actionable_leads_count');
    if (error) {
      console.error('[leads/actionable-count]', error);
      return jsonWithCors(request, { message: 'Lead counts could not be loaded.' }, { status: 500 });
    }

    return jsonWithCors(request, { count: typeof data === 'number' ? data : 0 }, { status: 200 });
  }

  const status = searchParams.get('status');

  const rawLimit = Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 1000) : 500;

  // List views don't need the heavy vendor payloads; the workspace drawer
  // fetches /api/leads/[id] for the full record. ?full=true opts back in.
  const columns =
    searchParams.get('full') === 'true'
      ? '*'
      : 'id,full_name,industry,category,phone,email,address,source,line_of_business,status,created_at,website,est_employees,est_revenue,estimated_premium,stage_changed_at,lost_reason,last_viewed_at,last_activity_at,archived_at,archive_reason,account_id';

  let query = supabase.from('leads').select(columns).order(status === 'archived' ? 'archived_at' : 'created_at', { ascending: false }).limit(limit);
  const accountId = searchParams.get('account_id');
  if (accountId) {
    if (!isUuid(accountId)) return jsonWithCors(request, { message: 'Choose a valid account.' }, { status: 400 });
    query = query.eq('account_id', accountId);
  }
  query = status === 'archived' ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const search = searchParams.get('q')?.trim();
  if (search) query = query.ilike('full_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
  if (status === 'open') {
    query = query.in('status', [...ACTIVE_LEAD_STATUSES]);
  } else if (status && ['won', 'lost', 'inactive'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.returns<Array<Record<string, unknown> & { id: string }>>();
  if (error) {
    console.error('[leads/get]', error);
    return jsonWithCors(request, { message: 'Leads could not be loaded. Refresh the page to try again.' }, { status: 500 });
  }

  const rows = data ?? [];
  if (!rows.length) return jsonWithCors(request, [], { status: 200 });
  try {
    const restrictions = await leadContactRestrictions(supabase, rows.map((row) => row.id));
    return jsonWithCors(request, rows.map((row) => ({ ...row, do_not_contact: restrictions.get(row.id) ?? true })), { status: 200 });
  } catch (failure) {
    console.error('[leads/contact-restrictions]', failure);
    return jsonWithCors(request, { message: 'Leads could not be loaded. Please try again.' }, { status: 503 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Public endpoint by design: external website forms post leads here (see website-integration.md).
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  let payload: NewLeadPayload & Record<string, unknown>;
  try {
    payload = await workspaceBody(request);
    for (const field of ['full_name', 'fullName', 'name', 'client_name', 'phone', 'email', 'address', 'source', 'line_of_business', 'line', 'insurance_line']) {
      if (payload[field] !== undefined && payload[field] !== null && typeof payload[field] !== 'string') {
        return jsonWithCors(request, { message: `${field} must be text.` }, { status: 400 });
      }
    }
  } catch (error) {
    return workspaceApiError(error, 'leads/post');
  }
  const fullName = normalizeText(payload.full_name) ?? normalizeText(payload.fullName) ?? normalizeText(payload.name) ?? normalizeText(payload.client_name);
  if (!fullName) {
    return jsonWithCors(request, { message: 'full_name is required.' }, { status: 400 });
  }

  const lineOfBusiness =
    normalizeText(payload.line_of_business) ??
    normalizeText(payload.line) ??
    normalizeText(payload.insurance_line) ??
    normalizeText(payload.primaryCoverage) ??
    normalizeText(payload.business) ??
    'General Request';
  const details = normalizeText(payload.details) ?? normalizeText(payload.vehicleDetails) ?? normalizeText(payload.message);

  const insertData = {
    full_name: fullName,
    phone: normalizeText(payload.phone),
    email: normalizeText(payload.email),
    zip: normalizeText(payload.zip),
    state: normalizeText(payload.state),
    business: normalizeText(payload.business),
    primary_coverage: normalizeText(payload.primaryCoverage),
    vehicle_details: normalizeText(payload.vehicleDetails),
    details,
    bundles: normalizeBundles(payload.bundles),
    line_of_business: lineOfBusiness,
    source: normalizeText(payload.source) ?? 'website',
    status: normalizeStatus(payload.status),
    form_payload: payload,
  };

  try {
    const receipts = await websiteSubmissionReceipts(supabase, [payload]);
    if (receipts.has(0)) return jsonWithCors(request, { id: receipts.get(0), duplicate: true }, { status: 200 });
  } catch (error) { return workspaceApiError(error, 'leads/submission-receipt'); }
  // Resubmission check: a repeat inquiry is a hot signal, not a new lead.
  const email = normalizeText(payload.email)?.toLowerCase() ?? null;
  const phoneDigitsValue = (normalizeText(payload.phone) ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  let existing: { id: string; full_name: string; status: string | null; form_payload: Record<string, unknown> | null } | null = null;
  if (email) {
    const byEmail = await supabase
      .from('leads')
      .select('id,full_name,status,form_payload')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string; full_name: string; status: string | null; form_payload: Record<string, unknown> | null }>();
    if (byEmail.error) return jsonWithCors(request, { message: friendlyErrorMessage(byEmail.error) }, { status: 500 });
    existing = byEmail.data ?? null;
  }
  if (!existing && phoneDigitsValue.length === 10) {
    const byPhone = await supabase
      .from('leads')
      .select('id,full_name,status,form_payload,phone')
      .order('created_at', { ascending: false })
      .limit(1000);
    if (byPhone.error) return jsonWithCors(request, { message: friendlyErrorMessage(byPhone.error) }, { status: 500 });
    existing =
      (byPhone.data ?? []).find(
        (row) => ((row.phone as string | null) ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') === phoneDigitsValue,
      ) ?? null;
  }

  if (existing) {
    try {
      const applied = await applyResubmission(supabase, existing, payload, {
        fullName, email, phone: normalizeText(payload.phone),
      });
      return jsonWithCors(request, { id: existing.id, resubmission: applied, duplicate: !applied }, { status: 200 });
    } catch (error) {
      return workspaceApiError(error, 'leads/resubmission');
    }
  }

  const { data, error } = await supabase.from('leads').insert([insertData]).select('*').single();
  if (error) {
    if (error.code === '23505') {
      try {
        const receipts = await websiteSubmissionReceipts(supabase, [payload]);
        if (receipts.has(0)) return jsonWithCors(request, { id: receipts.get(0), duplicate: true });
      } catch (failure) { return workspaceApiError(failure, 'leads/submission-receipt'); }
    }
    return jsonWithCors(request, { message: friendlyErrorMessage(error) }, { status: 500 });
  }

  await scheduleIntakeTask(supabase, {
    leadId: data.id,
    name: data.full_name,
    warm: isWarmSource(insertData.source, payload),
  });

  await processLeadStatusChanged({
    leadId: data.id,
    leadName: data.full_name,
    status: data.status,
  });


  return jsonWithCors(request, data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewLeadPayload;
  if (!payload.id) {
    return jsonWithCors(request, { message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | number | null> = {};
  if (typeof payload.name === 'string') updates.full_name = payload.name.trim();
  if (typeof payload.fullName === 'string') updates.full_name = payload.fullName.trim();
  if (typeof payload.full_name === 'string') updates.full_name = payload.full_name.trim();
  if (typeof payload.phone === 'string') updates.phone = payload.phone.trim() || null;
  if (typeof payload.email === 'string') updates.email = payload.email.trim() || null;
  if (typeof payload.zip === 'string') updates.zip = payload.zip.trim() || null;
  if (typeof payload.address === 'string') updates.address = payload.address.trim() || null;
  if (typeof payload.state === 'string') updates.state = payload.state.trim() || null;
  if (typeof payload.business === 'string') updates.business = payload.business.trim() || null;
  if (typeof payload.primaryCoverage === 'string') updates.primary_coverage = payload.primaryCoverage.trim() || null;
  if (typeof payload.vehicleDetails === 'string') updates.vehicle_details = payload.vehicleDetails.trim() || null;
  if (typeof payload.details === 'string') updates.details = payload.details.trim() || null;
  if (typeof payload.message === 'string') updates.details = payload.message.trim() || null;
  if (typeof payload.line_of_business === 'string') updates.line_of_business = payload.line_of_business.trim() || null;
  if (typeof payload.source === 'string') updates.source = payload.source.trim() || null;
  if (typeof payload.status === 'string') {
    const normalized = normalizeLeadStatus(payload.status);
    if (normalized) {
      updates.status = normalized;
      updates.stage_changed_at = new Date().toISOString();
    }
  }
  if (typeof payload.estimated_premium === 'number' || typeof payload.estimated_premium === 'string') {
    const raw =
      typeof payload.estimated_premium === 'string'
        ? Number(payload.estimated_premium.replace(/[$,]/g, ''))
        : payload.estimated_premium;
    if (Number.isFinite(raw)) {
      updates.estimated_premium = raw;
    }
  }

  if (Object.keys(updates).length === 0) {
    return jsonWithCors(request, { message: 'No update fields were provided.' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('patch_lead_profile', { p_lead_id: payload.id, p_changes: updates });
  if (error) {
    return workspaceApiError(databaseError(error), 'leads/patch');
  }

  await processLeadStatusChanged({
    leadId: data.id,
    leadName: data.full_name,
    status: data.status,
  });

  return jsonWithCors(request, data, { status: 200 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  // Leads are archived, never erased, so their history and linked records stay intact and can be restored.
  try {
    const payload = await workspaceBody(request);
    if (!isUuid(payload.id)) {
      return jsonWithCors(request, { message: 'Choose a lead to archive.' }, { status: 400 });
    }
    const saved = await supabase.rpc('archive_leads', { p_ids: [payload.id], p_actor: apiActorName(session.user), p_reason: null });
    if (saved.error) throw databaseError(saved.error);
    const results = parseLeadArchiveResults(saved.data);
    if (!results || results.length !== 1) throw new WorkspaceError('We could not confirm the change. Refresh the page to check the lead.', 503);
    if (results[0].outcome === 'missing') return jsonWithCors(request, { message: 'This lead was already removed. Refresh the page.' }, { status: 404 });
    return jsonWithCors(request, { ok: true, archived: true, results, message: describeLeadArchive('archive', results) }, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'leads/delete');
  }
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
