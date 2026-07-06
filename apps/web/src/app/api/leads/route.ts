import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { processLeadStatusChanged } from '../../../lib/automation';

interface NewLeadPayload {
  id?: string;
  name?: string;
  fullName?: string;
  full_name?: string;
  phone?: string;
  email?: string;
  zip?: string;
  state?: string;
  business?: string;
  primaryCoverage?: string;
  vehicleDetails?: string;
  details?: string;
  message?: string;
  bundles?: string | string[];
  line_of_business?: string;
  industry?: string;
  category?: string;
  address?: string;
  website?: string;
  est_employees?: string;
  est_revenue?: string;
  risk_exposure?: string;
  source?: string;
  status?: string;
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStatus(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || 'new';
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
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

function isMissingLeadsTableError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  return message.includes("Could not find the table 'public.leads' in the schema cache");
}

function isSchemaColumnError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  const value = message.toLowerCase();
  return value.includes('column') || value.includes('schema cache') || value.includes('does not exist');
}

function isMissingFunctionError(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  const value = message.toLowerCase();
  if (!value.includes('get_actionable_leads_count')) {
    return false;
  }

  return value.includes('does not exist') || value.includes('could not find the function') || value.includes('schema cache');
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status');
  const actionableCount = searchParams.get('actionableCount') === 'true';

  if (actionableCount) {
    const rpcResult = await supabase.rpc('get_actionable_leads_count');

    if (!rpcResult.error) {
      return jsonWithCors(request, { count: typeof rpcResult.data === 'number' ? rpcResult.data : 0 }, { status: 200 });
    }

    if (!isMissingFunctionError(rpcResult.error.message)) {
      if (isSchemaColumnError(rpcResult.error.message)) {
        return jsonWithCors(request, { count: 0 }, { status: 200 });
      }

      return jsonWithCors(request, { message: rpcResult.error.message }, { status: 500 });
    }

    const leadsWithTracking = await supabase
      .from('leads')
      .select('id,status,created_at,last_viewed_at,last_activity_at')
      .in('status', ['new', 'working', 'prospect'])
      .limit(500);

    if (leadsWithTracking.error && isSchemaColumnError(leadsWithTracking.error.message)) {
      const basicLeads = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .in('status', ['new', 'working', 'prospect']);

      if (basicLeads.error) {
        return jsonWithCors(request, { message: basicLeads.error.message }, { status: 500 });
      }

      return jsonWithCors(request, { count: basicLeads.count ?? 0 }, { status: 200 });
    }

    if (leadsWithTracking.error) {
      return jsonWithCors(request, { message: leadsWithTracking.error.message }, { status: 500 });
    }

    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
    const actionable = (leadsWithTracking.data ?? []).filter((lead) => {
      const lastViewedAt = lead.last_viewed_at ? new Date(lead.last_viewed_at).getTime() : null;
      const lastActivityAt = lead.last_activity_at ? new Date(lead.last_activity_at).getTime() : new Date(lead.created_at).getTime();

      if (!lastViewedAt || Number.isNaN(lastViewedAt)) {
        return true;
      }

      if (!Number.isNaN(lastActivityAt) && lastActivityAt > lastViewedAt) {
        return true;
      }

      return lastViewedAt <= cutoffMs;
    }).length;

    return jsonWithCors(request, { count: actionable }, { status: 200 });
  }

  let query = supabase.from('leads').select('*').order('created_at', { ascending: false }).limit(50);
  if (status === 'open') {
    query = query.in('status', ['new', 'working', 'quoted']);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingLeadsTableError(error.message)) {
      return jsonWithCors(request, [], { status: 200 });
    }

    return jsonWithCors(request, { message: error.message }, { status: 500 });
  }

  return jsonWithCors(request, data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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
    industry: normalizeText(payload.industry),
    category: normalizeText(payload.category),
    address: normalizeText(payload.address),
    website: normalizeText(payload.website),
    est_employees: normalizeText(payload.est_employees),
    est_revenue: normalizeText(payload.est_revenue),
    risk_exposure: normalizeText(payload.risk_exposure),
    source: normalizeText(payload.source) ?? 'website',
    status: normalizeStatus(payload.status),
    form_payload: payload,
  };

  const { data, error } = await supabase.from('leads').insert([insertData]).select('*').single();
  if (error) {
    return jsonWithCors(request, { message: error.message }, { status: 500 });
  }

  await processLeadStatusChanged({
    leadId: data.id,
    leadName: data.full_name,
    status: data.status,
  });

  return jsonWithCors(request, data, { status: 201 });
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as NewLeadPayload;
  if (!payload.id) {
    return jsonWithCors(request, { message: 'id is required.' }, { status: 400 });
  }

  const updates: Record<string, string | null> = {};
  if (typeof payload.name === 'string') updates.full_name = payload.name.trim();
  if (typeof payload.fullName === 'string') updates.full_name = payload.fullName.trim();
  if (typeof payload.full_name === 'string') updates.full_name = payload.full_name.trim();
  if (typeof payload.phone === 'string') updates.phone = payload.phone.trim() || null;
  if (typeof payload.email === 'string') updates.email = payload.email.trim() || null;
  if (typeof payload.zip === 'string') updates.zip = payload.zip.trim() || null;
  if (typeof payload.state === 'string') updates.state = payload.state.trim() || null;
  if (typeof payload.business === 'string') updates.business = payload.business.trim() || null;
  if (typeof payload.primaryCoverage === 'string') updates.primary_coverage = payload.primaryCoverage.trim() || null;
  if (typeof payload.vehicleDetails === 'string') updates.vehicle_details = payload.vehicleDetails.trim() || null;
  if (typeof payload.details === 'string') updates.details = payload.details.trim() || null;
  if (typeof payload.message === 'string') updates.details = payload.message.trim() || null;
  if (typeof payload.line_of_business === 'string') updates.line_of_business = payload.line_of_business.trim() || null;
  if (typeof payload.industry === 'string') updates.industry = payload.industry.trim() || null;
  if (typeof payload.category === 'string') updates.category = payload.category.trim() || null;
  if (typeof payload.address === 'string') updates.address = payload.address.trim() || null;
  if (typeof payload.website === 'string') updates.website = payload.website.trim() || null;
  if (typeof payload.est_employees === 'string') updates.est_employees = payload.est_employees.trim() || null;
  if (typeof payload.est_revenue === 'string') updates.est_revenue = payload.est_revenue.trim() || null;
  if (typeof payload.risk_exposure === 'string') updates.risk_exposure = payload.risk_exposure.trim() || null;
  if (typeof payload.source === 'string') updates.source = payload.source.trim() || null;
  if (typeof payload.status === 'string') updates.status = payload.status.trim();
  if (Object.prototype.hasOwnProperty.call(payload, 'last_viewed_at')) {
    const viewedAt = normalizeIsoDate(payload.last_viewed_at);
    if (payload.last_viewed_at !== null && !viewedAt) {
      return jsonWithCors(request, { message: 'Invalid last_viewed_at value.' }, { status: 400 });
    }

    updates.last_viewed_at = viewedAt;
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'last_activity_at')) {
    const activityAt = normalizeIsoDate(payload.last_activity_at);
    if (payload.last_activity_at !== null && !activityAt) {
      return jsonWithCors(request, { message: 'Invalid last_activity_at value.' }, { status: 400 });
    }

    updates.last_activity_at = activityAt;
  }

  if (Object.keys(updates).length === 0) {
    return jsonWithCors(request, { message: 'No update fields were provided.' }, { status: 400 });
  }

  let updateResult = await supabase.from('leads').update(updates).eq('id', payload.id).select('*').single();
  if (updateResult.error && isSchemaColumnError(updateResult.error.message)) {
    const { last_viewed_at: _ignoredViewed, last_activity_at: _ignoredActivity, ...fallbackUpdates } = updates;
    if (Object.keys(fallbackUpdates).length === 0) {
      return jsonWithCors(request, { message: 'Lead follow-up tracking columns are not available yet.' }, { status: 200 });
    }

    updateResult = await supabase.from('leads').update(fallbackUpdates).eq('id', payload.id).select('*').single();
  }

  const { data, error } = updateResult;
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
