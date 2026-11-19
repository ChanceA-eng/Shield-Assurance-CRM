import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { getApiSession } from '../../../lib/api-auth';
import { workspaceApiError, friendlyErrorMessage, workspaceBody } from '../../../lib/workspace-api';
import { POST as schedule } from '../../../lib/scheduled-communication';
import { SMS_UNAVAILABLE } from '../../../lib/message-delivery';
import { isUuid } from '../../../lib/workspace-validation';
import { hasUnresolvedSalesFields } from '@crm/shared';
import { messageDocument } from '../../../lib/email-formatting';

function isClientOrContactId(value: string | null): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('client_id') ?? request.nextUrl.searchParams.get('contact_id');
  let query = supabase.from('scheduled_messages').select('*').is('lead_id', null).not('client_id', 'is', null).order('send_at', { ascending: true }).limit(100);
  if (isClientOrContactId(clientId)) {
    query = query.eq('client_id', clientId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await workspaceBody(new NextRequest(request.clone()));
    return schedule(request, { params: Promise.resolve({ id: typeof payload.client_id === 'string' ? payload.client_id : '', type: 'client' }) });
  } catch (error) { return workspaceApiError(error, 'schedule/account'); }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const payload = await workspaceBody(request);

  if (!isUuid(payload.id)) {
    return NextResponse.json({ message: 'A valid scheduled message id is required.' }, { status: 400 });
  }
  if (payload.channel === 'sms') return NextResponse.json({ message: SMS_UNAVAILABLE.message }, { status: SMS_UNAVAILABLE.status });
  if (payload.channel !== undefined && payload.channel !== 'email') return NextResponse.json({ message: 'Choose email.' }, { status: 400 });
  if (payload.send_at !== undefined && (typeof payload.send_at !== 'string' || !Number.isFinite(Date.parse(payload.send_at)) || Date.parse(payload.send_at) <= Date.now())) {
    return NextResponse.json({ message: 'Choose a valid future send time.' }, { status: 400 });
  }
  if (payload.status !== undefined && (typeof payload.status !== 'string' || !['pending', 'cancelled'].includes(payload.status))) {
    return NextResponse.json({ message: 'Delivery status is managed by the sender. Only pending messages can be edited or cancelled.' }, { status: 400 });
  }
  if (payload.body !== undefined && (typeof payload.body !== 'string' || !payload.body.trim() || payload.body.length > 50000)) {
    return NextResponse.json({ message: 'Provide a message of at most 50,000 characters.' }, { status: 400 });
  }
  if (payload.subject !== undefined && payload.subject !== null && (typeof payload.subject !== 'string' || payload.subject.length > 1000)) {
    return NextResponse.json({ message: 'Provide a subject of at most 1,000 characters.' }, { status: 400 });
  }
  if (hasUnresolvedSalesFields(String(payload.body ?? '')) || hasUnresolvedSalesFields(String(payload.subject ?? ''))) {
    return NextResponse.json({ message: 'Complete template details before saving this schedule.' }, { status: 400 });
  }
  const attempt = await supabase.from('agent_email_attempts').select('id').eq('id', payload.id).maybeSingle();
  if (attempt.error || attempt.data) return NextResponse.json({ message: 'Only unattempted scheduled messages can be changed. Do not retry an uncertain send.' }, { status: 409 });

  const updates: Record<string, unknown> = {};
  if (typeof payload.send_at === 'string') updates.send_at = payload.send_at;
  if (typeof payload.channel === 'string') updates.channel = payload.channel;
  if (typeof payload.subject === 'string') updates.subject = payload.subject.trim();
  if (typeof payload.body === 'string') {
    updates.body = payload.body;
    updates.body_document = messageDocument(payload.body_document, payload.body) ?? null;
  } else if (payload.body_document !== undefined) return NextResponse.json({ message: 'Include the message text when changing its formatting.' }, { status: 400 });
  if (typeof payload.status === 'string') updates.status = payload.status.trim();
  if (typeof payload.automation_type === 'string') updates.automation_type = payload.automation_type.trim();
  if (payload.subject === null) updates.subject = '';
  if (!Object.keys(updates).length) return NextResponse.json({ message: 'Provide a scheduling change.' }, { status: 400 });

  const { data, error } = await supabase.from('scheduled_messages').update(updates).eq('id', payload.id).is('lead_id', null)
    .not('client_id', 'is', null).eq('status', 'pending')
    .or(`agent_user_id.is.null,agent_user_id.eq.${session.user.id}`).select('*').maybeSingle();
  if (error) {
    return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  }
  if (!data) return NextResponse.json({ message: 'This message is no longer pending or belongs to another agent.' }, { status: 409 });

  return NextResponse.json(data, { status: 200 });
  } catch (error) { return workspaceApiError(error, 'schedule/update'); }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const payload = await workspaceBody(request);
  if (!isUuid(payload.id)) {
    return NextResponse.json({ message: 'A valid scheduled message id is required.' }, { status: 400 });
  }

  const { data, error } = await supabase.from('scheduled_messages').update({ status: 'cancelled' }).eq('id', payload.id).is('lead_id', null)
    .not('client_id', 'is', null).eq('status', 'pending')
    .or(`agent_user_id.is.null,agent_user_id.eq.${session.user.id}`).select('id').maybeSingle();
  if (error) {
    return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  }
  if (!data) return NextResponse.json({ message: 'This message is no longer pending or belongs to another agent.' }, { status: 409 });

  return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) { return workspaceApiError(error, 'schedule/cancel'); }
}