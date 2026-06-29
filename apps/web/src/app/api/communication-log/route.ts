import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { sendEmail } from '../../../lib/messaging';
import { appendAgencySignature } from '../../../lib/agency-signature';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('client_id') ?? request.nextUrl.searchParams.get('contact_id');
  let query = supabase.from('communication_log').select('*').order('sent_at', { ascending: false }).limit(100);
  if (clientId) query = query.eq('client_id', clientId);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json()) as {
    client_id?: string;
    channel?: 'email' | 'sms';
    direction?: 'outbound' | 'inbound';
    subject?: string;
    body?: string;
    automation_type?: string;
    to?: string;
    attachments?: Array<{ filename?: string; content?: string; type?: string }>;
    profile_files?: Array<{ id?: string; file_name?: string; file_url?: string }>;
  };

  if (!payload.channel || !payload.body || !payload.automation_type) {
    return NextResponse.json({ message: 'channel, body and automation_type are required.' }, { status: 400 });
  }

  const subject = payload.subject?.trim() || (payload.channel === 'email' ? 'Message from Shield Assurance CRM' : 'SMS Notification');
  const direction = payload.direction ?? 'outbound';

  const profileFiles = (payload.profile_files ?? [])
    .map((file) => ({
      id: file.id?.trim() || '',
      file_name: file.file_name?.trim() || 'Client file',
      file_url: file.file_url?.trim() || '',
    }))
    .filter((file) => file.file_url);

  const profileLinksBlock = profileFiles.length > 0
    ? `\n\nAttached client file links:\n${profileFiles.map((item) => `- ${item.file_name}: ${item.file_url}`).join('\n')}`
    : '';

  const mergedBody = `${payload.body}${profileLinksBlock}`;
  const style = payload.automation_type?.trim().toLowerCase() === 'manual' ? 'personal' : 'system';
  const messageBody = direction === 'outbound' ? appendAgencySignature(mergedBody, style) : mergedBody;

  const attachments = (payload.attachments ?? [])
    .map((attachment) => ({
      filename: attachment.filename?.trim() || '',
      content: attachment.content?.trim() || '',
      type: attachment.type?.trim() || 'application/octet-stream',
    }))
    .filter((attachment) => attachment.filename && attachment.content);

  if (payload.channel === 'email' && direction === 'outbound') {
    let recipientEmail = payload.to?.trim().toLowerCase() ?? '';

    if (!recipientEmail && payload.client_id) {
      const clientEmailLookup = await supabase.from('clients').select('email').eq('id', payload.client_id).maybeSingle();
      if (clientEmailLookup.error) {
        return NextResponse.json({ message: clientEmailLookup.error.message }, { status: 500 });
      }
      recipientEmail = (clientEmailLookup.data?.email ?? '').trim().toLowerCase();
    }

    if (!recipientEmail) {
      return NextResponse.json({ message: 'Recipient email is required. Provide to or client_id with a valid client email.' }, { status: 400 });
    }

    try {
      await sendEmail({
        to: recipientEmail,
        subject,
        body: messageBody,
        attachments,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown email delivery failure';
      return NextResponse.json({ message: `Email delivery failed: ${message}` }, { status: 502 });
    }
  }

  const { data, error } = await supabase
    .from('communication_log')
    .insert([
      {
        client_id: payload.client_id ?? null,
        channel: payload.channel,
        direction,
        subject,
        body: messageBody,
        automation_type: payload.automation_type,
        sent_at: new Date().toISOString(),
      },
    ])
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      ...data,
      delivery: payload.channel === 'email' && direction === 'outbound' ? 'accepted_by_sendgrid' : 'logged_only',
    },
    { status: 201 },
  );
}
