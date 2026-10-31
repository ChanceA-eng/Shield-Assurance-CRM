import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';
import { processLeadStatusChanged } from '../../../lib/automation';
import { ACTIVE_LEAD_STATUSES, normalizeLeadStatus } from '../../../lib/lead-pipeline';
import { scheduleIntakeTask, isWarmSource } from '../../../lib/intake-task';
import { applyResubmission } from '../../../lib/resubmission';

interface NewLeadPayload {
  id?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
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
  source?: string;
  status?: string;
  estimated_premium?: number | string;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
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
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get('actionableCount') === 'true') {
    const { data, error } = await supabase.rpc('get_actionable_leads_count');
    if (error) {
      return jsonWithCors(request, { message: error.message }, { status: 500 });
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
      : 'id,full_name,industry,category,phone,email,address,source,line_of_business,status,created_at,website,est_employees,est_revenue,estimated_premium,stage_changed_at,lost_reason,last_viewed_at,last_activity_at';

  let query = supabase.from('leads').select(columns).order('created_at', { ascending: false }).limit(limit);
  if (status === 'open') {
    query = query.in('status', [...ACTIVE_LEAD_STATUSES]);
  } else if (status && ['won', 'lost', 'inactive'].includes(status)) {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) {
    return jsonWithCors(request, { message: error.message }, { status: 500 });
  }

  return jsonWithCors(request, data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Public endpoint by design: external website forms post leads here (see website-integration.md).
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewLeadPayload;
  const fullName = normalizeText(payload.full_name) ?? normalizeText(payload.fullName) ?? normalizeText(payload.name);
  if (!fullName) {
    return jsonWithCors(request, { message: 'full_name is required.' }, { status: 400 });
  }

  const lineOfBusiness =
    normalizeText(payload.line_of_business) ??
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
    existing = byEmail.data ?? null;
  }
  if (!existing && phoneDigitsValue.length === 10) {
    const byPhone = await supabase
      .from('leads')
      .select('id,full_name,status,form_payload,phone')
      .order('created_at', { ascending: false })
      .limit(1000);
    existing =
      (byPhone.data ?? []).find(
        (row) => ((row.phone as string | null) ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '') === phoneDigitsValue,
      ) ?? null;
  }

  if (existing) {
    await applyResubmission(supabase, existing, payload as Record<string, unknown>, {
      fullName: normalizeText(payload.fullName) ?? normalizeText(payload.full_name) ?? normalizeText(payload.name),
      email,
      phone: normalizeText(payload.phone),
    });
    return jsonWithCors(request, { id: existing.id, resubmission: true }, { status: 200 });
  }

  const { data, error } = await supabase.from('leads').insert([insertData]).select('*').single();
  if (error) {
    return jsonWithCors(request, { message: error.message }, { status: 500 });
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
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
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

  const { data, error } = await supabase.from('leads').update(updates).eq('id', payload.id).select('*').single();
  if (error) {
    return jsonWithCors(request, { message: error.message }, { status: 500 });
  }

  await processLeadStatusChanged({
    leadId: data.id,
    leadName: data.full_name,
    status: data.status,
  });

  return jsonWithCors(request, data, { status: 200 });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as { id?: string };
  if (!payload.id) {
    return jsonWithCors(request, { message: 'id is required.' }, { status: 400 });
  }

  const { error } = await supabase.from('leads').delete().eq('id', payload.id);
  if (error) {
    return jsonWithCors(request, { message: error.message }, { status: 500 });
  }

  return jsonWithCors(request, { ok: true }, { status: 200 });
}

export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}
