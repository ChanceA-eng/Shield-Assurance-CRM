import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

interface SendGridMessageItem {
  msg_id?: string;
  to_email?: string;
  from_email?: string;
  subject?: string;
  status?: string;
  last_event_time?: string;
}

interface SendGridMessagesResponse {
  messages?: SendGridMessageItem[];
}

function normalizeEmail(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ message: 'SendGrid is not configured.' }, { status: 503 });
  }

  const supabase = getSupabaseServerClient();
  const clientId = request.nextUrl.searchParams.get('client_id');
  let toEmail = normalizeEmail(request.nextUrl.searchParams.get('to_email'));

  if (!toEmail && clientId && supabase) {
    const lookup = await supabase.from('clients').select('email').eq('id', clientId).maybeSingle();
    if (lookup.error) {
      return NextResponse.json({ message: lookup.error.message }, { status: 500 });
    }
    toEmail = normalizeEmail(lookup.data?.email ?? null);
  }

  const limitValue = Number(request.nextUrl.searchParams.get('limit') ?? '25');
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 25;

  const response = await fetch(`https://api.sendgrid.com/v3/messages?limit=${limit}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await response.text().catch(() => 'No response body');
    return NextResponse.json({ message: `SendGrid activity query failed (${response.status}): ${details}` }, { status: 502 });
  }

  const payload = (await response.json()) as SendGridMessagesResponse;
  const rows = (payload.messages ?? [])
    .filter((message) => {
      if (!toEmail) return true;
      return normalizeEmail(message.to_email ?? null) === toEmail;
    })
    .map((message) => ({
      msg_id: message.msg_id ?? '',
      to_email: message.to_email ?? null,
      from_email: message.from_email ?? null,
      subject: message.subject ?? null,
      status: message.status ?? 'unknown',
      last_event_time: message.last_event_time ?? null,
    }))
    .sort((left, right) => {
      const leftTs = new Date(left.last_event_time ?? 0).getTime();
      const rightTs = new Date(right.last_event_time ?? 0).getTime();
      return rightTs - leftTs;
    });

  return NextResponse.json(rows, { status: 200 });
}
