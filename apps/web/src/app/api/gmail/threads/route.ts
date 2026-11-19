import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled } from '../../../../lib/agency-membership';
import { getOwnGmailConnection } from '../../../../lib/gmail-provider';
import { eligibleAiMessages, recordOutreachContext, type OutreachConversation } from '../../../../lib/lead-outreach-context';
import { draftOutreach } from '../../../../lib/outreach-ai';
import { resolveRecordScope, WorkspaceError } from '../../../../lib/record-scope';
import { workspaceApiError, workspaceBody, databaseError } from '../../../../lib/workspace-api';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  if (!agencyEnabled() && process.env.CRM_GMAIL_ENABLED !== 'true') return NextResponse.json({ enabled: false });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const type = request.nextUrl.searchParams.get('record_type');
    const id = request.nextUrl.searchParams.get('record_id') ?? '';
    if (type !== 'lead' && type !== 'client') throw new WorkspaceError('Choose a contact.', 400);
    const scope = await resolveRecordScope(db, { type, id });
    const key = scope.clientId ? `client:${scope.clientId}` : `lead:${scope.leadId}`;
    if (request.method === 'GET') {
      const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
      if (!Number.isSafeInteger(offset) || offset < 0) throw new WorkspaceError('Choose a valid thread page.', 400);
      const rows = await db.from('canonical_communications').select('id,direction,subject,body,sent_at,metadata', { count: 'exact' })
        .eq('conversation_key', key).eq('metadata->>provider', 'gmail').order('sent_at', { ascending: false }).order('id')
        .range(offset, offset + 49);
      if (rows.error) throw databaseError(rows.error);
      const member = await activeAgencyMember(db, session.user.id);
      const mailbox = process.env.CRM_GMAIL_ENABLED === 'true' ? await getOwnGmailConnection(db, session.user.id) : null;
      const links = mailbox && rows.data?.length ? await db.from('gmail_message_links').select('communication_id,gmail_thread_id')
        .eq('connection_id', mailbox.id).in('communication_id', rows.data.map((row) => row.id)) : null;
      if (links?.error) throw databaseError(links.error);
      return NextResponse.json({ enabled: true, rows: rows.data?.map((row) => {
        const own = links?.data?.find((link) => link.communication_id === row.id);
        return { ...row, gmail_url: own && mailbox ? `https://mail.google.com/mail/u/${encodeURIComponent(mailbox.email)}/#all/${encodeURIComponent(own.gmail_thread_id)}` : null };
      }), total: rows.count, next_offset: offset + 50 < (rows.count ?? 0) ? offset + 50 : null,
        sender: { name: member.sender_profile?.name ?? member.email, email: mailbox?.email ?? null, status: mailbox?.status ?? 'not_connected' } });
    }
    const body = await workspaceBody(request);
    if (!isUuid(body.reply_id)) throw new WorkspaceError('Select a message to reply to.', 400);
    const reply = await db.from('canonical_communications').select('id,direction,subject,body,sent_at,metadata').eq('conversation_key', key).eq('id', body.reply_id).single();
    if (reply.error) throw databaseError(reply.error);
    const metadata = isRecord(reply.data.metadata) ? reply.data.metadata : {};
    if (typeof metadata.gmail_thread_id !== 'string' || typeof metadata.gmail_connection_id !== 'string') throw new WorkspaceError('This message has no Gmail thread.', 409);
    const selected = await db.from('canonical_communications').select('id,direction,subject,body,sent_at,metadata').eq('conversation_key', key)
      .eq('metadata->>gmail_thread_id', metadata.gmail_thread_id).eq('metadata->>gmail_connection_id', metadata.gmail_connection_id)
      .order('sent_at', { ascending: false }).limit(12).returns<OutreachConversation[]>();
    if (selected.error) throw databaseError(selected.error);
    const eligible = await eligibleAiMessages(db, selected.data ?? []);
    if (!eligible.some((message) => message.id === body.reply_id)) throw new WorkspaceError('AI use of this Gmail thread is not authorized by all source agents or the provider privacy gate.', 403);
    const context = await recordOutreachContext(db, { type, id }, session.user.id);
    const lead = type === 'lead' ? await db.from('leads').select('full_name,form_payload,line_of_business').eq('id', id).single() : null;
    if (lead?.error) throw databaseError(lead.error);
    const draft = await draftOutreach({
      full_name: scope.name, ...lead?.data, ...context, recent_conversation: eligible,
    }, 'Draft a reply to the latest customer message in this selected thread. Answer their actual question, do not repeat already supplied information, and do not claim coverage is bound. This is a draft for human review, never an instruction to send.');
    if (!draft) throw new WorkspaceError('AI drafting is unavailable. No substitute reply was generated.', 503);
    return NextResponse.json({ ...draft, messages_used: eligible.length, available_messages: selected.data?.length ?? 0 });
  } catch (error) { return workspaceApiError(error, 'gmail/threads'); }
}
export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function POST(request: NextRequest): Promise<NextResponse> { return handle(request); }
