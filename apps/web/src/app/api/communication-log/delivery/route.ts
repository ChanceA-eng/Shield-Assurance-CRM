import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { friendlyErrorMessage } from '../../../../lib/workspace-api';
import { emailReceiptTimes, strongestDeliveryEvent } from '../../../../lib/email-delivery-status';

function normalizeEmail(value: string | null): string {
  return value?.trim().toLowerCase() ?? '';
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Email delivery history is temporarily unavailable.' }, { status: 503 });
  const clientId = request.nextUrl.searchParams.get('client_id');
  let toEmail = normalizeEmail(request.nextUrl.searchParams.get('to_email'));
  if (!toEmail && clientId) {
    const lookup = await supabase.from('clients').select('email').eq('id', clientId).maybeSingle();
    if (lookup.error) return NextResponse.json({ message: friendlyErrorMessage(lookup.error) }, { status: 500 });
    toEmail = normalizeEmail(lookup.data?.email ?? null);
    if (!toEmail) return NextResponse.json([]);
  }
  const limitValue = Number(request.nextUrl.searchParams.get('limit') ?? '25');
  const limit = Number.isFinite(limitValue) ? Math.max(1, Math.min(100, limitValue)) : 25;
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ message: 'Choose a valid delivery history page.' }, { status: 400 });
  let query = supabase.from('resend_send_attempts').select('id,request_key,provider_id,to_email,subject,status,created_at,resend_delivery_events(type,occurred_at)', { count: 'exact' })
    .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + limit - 1);
  if (toEmail) query = query.eq('to_email', toEmail);
  const result = await query;
  if (result.error) return NextResponse.json({ message: friendlyErrorMessage(result.error) }, { status: 500 });
  return NextResponse.json((result.data ?? []).map((row) => {
    const event = strongestDeliveryEvent(row.resend_delivery_events);
    return {
      msg_id: row.provider_id ?? row.id, request_key: row.request_key, to_email: row.to_email, from_email: process.env.RESEND_FROM_EMAIL ?? null,
      subject: row.subject, status: event?.type.replace('email.', '') ?? (row.status === 'accepted' ? 'accepted_by_provider' : 'acceptance_unknown'),
      last_event_time: event?.occurred_at ?? row.created_at,
      ...emailReceiptTimes(row.resend_delivery_events),
    };
  }), { headers: { 'X-Total-Count': String(result.count ?? 0), 'X-Next-Offset': offset + (result.data?.length ?? 0) < (result.count ?? 0) ? String(offset + (result.data?.length ?? 0)) : '' } });
}
