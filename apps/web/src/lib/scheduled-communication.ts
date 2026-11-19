import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { activeAgencyMember, agencyEnabled } from './agency-membership';
import { getAgentEmailSender } from './agent-email-sender';
import { getOwnGmailConnection } from './gmail-provider';
import { resolveOutboundEmailRecipient, SMS_UNAVAILABLE } from './message-delivery';
import { databaseError, workspaceApiError, workspaceBody } from './workspace-api';
import { isRecord, isUuid } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { hasUnresolvedSalesFields, emailDesignErrors, parseEmailDesign, parseEmailDocument } from '@crm/shared';
import { templateSnapshot } from './sales-templates';
import { getOutreachSender } from './marketing-profile';
import { messageDocument } from './email-formatting';

export interface ScheduleContext { params: Promise<{ id: string; type?: 'lead' | 'client' | 'unmatched' }> }

async function scheduleAccess(request: NextRequest, context: ScheduleContext) {
  const session = await getApiSession(request);
  if (session.error) throw new WorkspaceError('Sign in before scheduling email.', 401);
  const db = getSupabaseServerClient();
  if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
  const { id, type = 'lead' } = await context.params;
  if (type !== 'unmatched' && !isUuid(id)) throw new WorkspaceError('Choose a valid contact.', 400);
  const member = await activeAgencyMember(db, session.user.id);
  if (type === 'unmatched') {
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(id)) throw new WorkspaceError('Choose an email conversation.', 400);
    return { db, id: id.toLowerCase(), actor: session.user.id, column: 'approved_recipient' as const, type };
  }
  const lead = type === 'lead'
    ? await db.from('leads').select('id,agent_user_id,archived_at').eq('id', id).maybeSingle()
    : await db.from('clients').select('id,agent_user_id').eq('id', id).maybeSingle();
  if (lead.error) throw databaseError(lead.error);
  if (!lead.data || (lead.data.agent_user_id && lead.data.agent_user_id !== session.user.id && member.role === 'agent')) {
    throw new WorkspaceError('Contact not found or unavailable.', 404);
  }
  if ('archived_at' in lead.data && lead.data.archived_at) throw new WorkspaceError('Restore this lead before scheduling email.', 409);
  return { db, id, actor: session.user.id, column: type === 'lead' ? 'lead_id' as const : 'client_id' as const, type };
}

export async function GET(request: NextRequest, context: ScheduleContext): Promise<NextResponse> {
  try {
    const { db, id, actor, column, type } = await scheduleAccess(request, context);
    let query = db.from('scheduled_messages').select('id,send_at,subject,status,last_error')
      .eq(column, id).eq('agent_user_id', actor).in('status', ['pending', 'processing', 'failed']);
    if (type === 'unmatched') query = query.is('lead_id', null).is('client_id', null);
    const result = await query.order('send_at').limit(100);
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'lead/scheduled-messages'); }
}

export async function POST(request: NextRequest, context: ScheduleContext): Promise<NextResponse> {
  try {
    const { db, id, actor, column, type } = await scheduleAccess(request, context);
    const body = await workspaceBody(request);
    if (body.email_provider !== undefined && body.email_provider !== 'gmail' && body.email_provider !== 'resend') {
      throw new WorkspaceError('Choose a supported email sender.', 400);
    }
    const useGmail = body.email_provider === 'gmail' || (body.email_provider === undefined && agencyEnabled());
    if (body.channel === 'sms') throw new WorkspaceError(SMS_UNAVAILABLE.message, SMS_UNAVAILABLE.status);
    if (body.channel !== undefined && body.channel !== 'email') throw new WorkspaceError('Choose email. Text sending is not connected.', 400);
    if (hasUnresolvedSalesFields(String(body.body ?? '')) || hasUnresolvedSalesFields(String(body.subject ?? ''))) {
      throw new WorkspaceError('Complete the template details before scheduling.', 400);
    }
    if (!isUuid(body.request_id) || typeof body.body !== 'string' || !body.body.trim() || body.body.length > 50000
      || typeof body.subject !== 'string' || body.subject.length > 1000
      || typeof body.send_at !== 'string' || !Number.isFinite(Date.parse(body.send_at))) {
      throw new WorkspaceError('Provide an email, valid scheduled time and request identity.', 400);
    }
    const values = {
      id: body.request_id, [column]: id, agent_user_id: actor, channel: 'email',
      subject: body.subject.trim() || 'Message from Shield Assurance', body: body.body.trim(),
      send_at: new Date(body.send_at).toISOString(), automation_type: 'manual', status: 'pending',
    };
    const bodyDocument = messageDocument(body.body_document, values.body);
    const existing = await db.from('scheduled_messages').select('*').eq('id', body.request_id).maybeSingle();
    if (existing.error) throw databaseError(existing.error);
    if (existing.data) {
      if (Object.entries(values).some(([key, value]) => key === 'send_at'
        ? Date.parse(existing.data.send_at) !== Date.parse(values.send_at)
        : key !== 'status' && existing.data[key] !== value)) {
        throw new WorkspaceError('This scheduling request changed. Reload before trying again.', 409);
      }
      if (type === 'unmatched' && (existing.data.lead_id || existing.data.client_id)) {
        throw new WorkspaceError('This request belongs to another contact.', 409);
      }
      if (Boolean(existing.data.gmail_connection_id) !== useGmail) {
        throw new WorkspaceError('This scheduling request already uses a different email sender. Review before scheduling again.', 409);
      }
      const submitted = body.sales_template;
      if (JSON.stringify(bodyDocument ?? null) !== JSON.stringify(parseEmailDocument(existing.data.body_document) ?? null)) {
        throw new WorkspaceError('The scheduled message formatting changed. Review before retrying.', 409);
      }
      const stored = existing.data.sales_template;
      if (Boolean(submitted) !== Boolean(stored) || (submitted && stored && (
        !isRecord(submitted) || !isRecord(stored) || emailDesignErrors(submitted.email_design).length > 0
        || emailDesignErrors(stored.email_design).length > 0
        || submitted.id !== stored.id || submitted.revision !== stored.revision
        || JSON.stringify(parseEmailDesign(submitted.email_design)) !== JSON.stringify(parseEmailDesign(stored.email_design))
      ))) throw new WorkspaceError('This scheduling request has different template details. Reload before trying again.', 409);
      return NextResponse.json({ id: existing.data.id, send_at: existing.data.send_at, status: existing.data.status });
    }
    if (Date.parse(values.send_at) <= Date.now()) throw new WorkspaceError('Choose a future send time.', 400);
    const provenance = await templateSnapshot(db, body.sales_template);
    const target = await resolveOutboundEmailRecipient(db, type === 'lead' ? { leadId: id }
      : type === 'client' ? { clientId: id } : { conversationKey: `unmatched:${id}` });
    if (!target.ok) throw new WorkspaceError(target.message, target.status);
    let mailboxIdentity = {};
    if (useGmail) {
      const mailbox = await getOwnGmailConnection(db, actor);
      if (!mailbox || mailbox.status !== 'connected') throw new WorkspaceError('Connect your Gmail mailbox first.', 409);
      mailboxIdentity = { gmail_connection_id: mailbox.id, approved_sender: await getAgentEmailSender(db, actor) };
    } else {
      const personal = provenance ? await getOutreachSender(db) : await getAgentEmailSender(db, actor);
      mailboxIdentity = { approved_sender: personal };
    }
    const result = await db.from('scheduled_messages').insert({
      ...values, ...mailboxIdentity, approved_recipient: target.recipient.to,
      ...(provenance ? { sales_template: provenance } : {}),
      ...(bodyDocument ? { body_document: bodyDocument } : {}),
    }).select('id,send_at,status').single();
    if (result.error) throw databaseError(result.error);
    return NextResponse.json(result.data, { status: 201 });
  } catch (error) { return workspaceApiError(error, 'lead/schedule-email'); }
}

export async function DELETE(request: NextRequest, context: ScheduleContext): Promise<NextResponse> {
  try {
    const { db, id, actor, column, type } = await scheduleAccess(request, context);
    const body = await workspaceBody(request);
    if (!isUuid(body.id)) throw new WorkspaceError('Choose a scheduled email.', 400);
    let query = db.from('scheduled_messages').update({ status: 'cancelled' })
      .eq('id', body.id).eq(column, id).eq('agent_user_id', actor).eq('status', 'pending');
    if (type === 'unmatched') query = query.is('lead_id', null).is('client_id', null);
    const result = await query.select('id').maybeSingle();
    if (result.error) throw databaseError(result.error);
    if (!result.data) throw new WorkspaceError('This email is no longer pending. Reload its status.', 409);
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'lead/cancel-email'); }
}
