import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

export const runtime = 'nodejs';

interface SyncLeadRecord {
  full_name: string;
  email: string | null;
  phone: string | null;
  details: string | null;
  source: string;
  status: string;
  form_payload: Record<string, unknown>;
}

function isAuthorizedCron(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (cronSecret && bearer === cronSecret) return true;

  const userAgent = (request.headers.get('user-agent') ?? '').toLowerCase();
  if (userAgent.includes('vercel-cron')) return true;

  return !cronSecret;
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return null;
}

function normalizeStatus(value: unknown): string {
  const normalized = asString(value)?.toLowerCase();
  return normalized || 'new';
}

function extractLeadArray(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
  }

  if (typeof payload === 'object' && payload !== null) {
    const data = (payload as { data?: unknown }).data;
    if (Array.isArray(data)) {
      return data.filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null);
    }
  }

  return [];
}

function buildDetails(lead: Record<string, unknown>): string | null {
  const excluded = new Set(['full_name', 'name', 'email', 'phone', 'status']);
  const lines = Object.entries(lead)
    .filter(([key]) => !excluded.has(key.toLowerCase()))
    .map(([key, value]) => {
      const normalized = asString(value);
      if (normalized) {
        return `${key.toUpperCase()}: ${normalized}`;
      }

      try {
        return `${key.toUpperCase()}: ${JSON.stringify(value)}`;
      } catch {
        return `${key.toUpperCase()}: [unserializable]`;
      }
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join('\n') : null;
}

function normalizeExternalLead(lead: Record<string, unknown>): SyncLeadRecord {
  const fullName = asString(lead.full_name) ?? asString(lead.name) ?? 'Unknown Web Lead';
  const emailRaw = asString(lead.email);
  const email = emailRaw ? emailRaw.toLowerCase() : null;

  return {
    full_name: fullName,
    email,
    phone: asString(lead.phone),
    details: buildDetails(lead),
    source: 'website-pull',
    status: normalizeStatus(lead.status),
    form_payload: lead,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ message: 'Unauthorized cron request.' }, { status: 401 });
  }

  const exportUrl = process.env.WEBSITE_LEADS_EXPORT_URL?.trim() || 'https://www.shield-assurance.com/api/export-submissions';
  const syncToken = process.env.WEBSITE_SYNC_TOKEN?.trim();

  if (!syncToken) {
    return NextResponse.json({ message: 'WEBSITE_SYNC_TOKEN is not configured.' }, { status: 503 });
  }

  const webResponse = await fetch(exportUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${syncToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  if (!webResponse.ok) {
    return NextResponse.json(
      { message: `Failed to pull website submissions. HTTP ${webResponse.status} ${webResponse.statusText}` },
      { status: 502 },
    );
  }

  const responsePayload: unknown = await webResponse.json();
  const externalLeads = extractLeadArray(responsePayload);

  if (externalLeads.length === 0) {
    return NextResponse.json({ ok: true, pulled: 0, inserted: 0, skippedExisting: 0 }, { status: 200 });
  }

  const normalizedLeads = externalLeads.map(normalizeExternalLead);
  const candidateEmails = Array.from(new Set(normalizedLeads.map((lead) => lead.email).filter((email): email is string => Boolean(email))));

  let existingEmails = new Set<string>();
  if (candidateEmails.length > 0) {
    const existingResult = await supabase.from('leads').select('email').in('email', candidateEmails);
    if (existingResult.error) {
      return NextResponse.json({ message: existingResult.error.message }, { status: 500 });
    }

    existingEmails = new Set(
      (existingResult.data ?? [])
        .map((row) => asString((row as { email?: unknown }).email)?.toLowerCase())
        .filter((email): email is string => Boolean(email)),
    );
  }

  const insertRecords = normalizedLeads.filter((lead) => !(lead.email && existingEmails.has(lead.email)));
  const skippedExisting = normalizedLeads.length - insertRecords.length;

  if (insertRecords.length === 0) {
    return NextResponse.json(
      {
        ok: true,
        pulled: normalizedLeads.length,
        inserted: 0,
        skippedExisting,
      },
      { status: 200 },
    );
  }

  const insertResult = await supabase.from('leads').insert(insertRecords).select('id');
  if (insertResult.error) {
    return NextResponse.json({ message: insertResult.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      pulled: normalizedLeads.length,
      inserted: insertResult.data?.length ?? insertRecords.length,
      skippedExisting,
    },
    { status: 200 },
  );
}