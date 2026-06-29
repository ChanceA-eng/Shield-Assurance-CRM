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
  source?: string;
  status?: string;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeStatus(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized || 'new';
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

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return jsonWithCors(request, { message: 'Supabase is not configured.' }, { status: 503 });
  }

  const searchParams = request.nextUrl.searchParams;
  const status = searchParams.get('status');

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
  if (typeof payload.source === 'string') updates.source = payload.source.trim() || null;
  if (typeof payload.status === 'string') updates.status = payload.status.trim();

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
