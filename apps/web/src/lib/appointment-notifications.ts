import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { calendarCallbackUrl, calendarStateHash, newManageToken } from './google-calendar';
import { openGmailSecret, sealGmailSecret } from './gmail-provider';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { parseConversationKey } from './conversations';
import { appointmentDetails } from './appointment-confirmation';
import { listSalesTemplates, renderSalesTemplate, salesFacts } from './sales-templates';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { sendAgentEmail } from './agent-email';
import { ownedAppointment, type Appointment } from './appointment-lifecycle';

export type AppointmentNotificationKind = 'confirmation' | 'rescheduled' | 'cancelled';
export function appointmentNotificationKind(event: Pick<Appointment, 'status' | 'revision'>): AppointmentNotificationKind {
  return event.status === 'cancelled' ? 'cancelled' : event.revision > 0 ? 'rescheduled' : 'confirmation';
}
export function appointmentAttemptId(event: Pick<Appointment, 'id' | 'revision'>, kind: AppointmentNotificationKind): string {
  // Preserve the original first-confirmation identity for appointments that
  // already had a receipt before Calendar was introduced.
  if (event.revision === 0 && kind === 'confirmation') return event.id;
  const hex = createHash('sha256').update(`appointment:${event.id}:${event.revision}:${kind}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function appointmentManageUrl(db: SupabaseClient, event: Appointment): Promise<string> {
  const existing = await db.from('appointment_manage_tokens').select('token_secret,expires_at').eq('event_id', event.id).maybeSingle();
  if (existing.error) throw databaseError(existing.error);
  let token: string;
  if (existing.data && Date.parse(existing.data.expires_at) > Date.now()) {
    token = openGmailSecret(existing.data.token_secret, event.user_id);
  } else {
    const fresh = newManageToken();
    const fields = { event_id: event.id, token_hash: calendarStateHash(fresh), token_secret: sealGmailSecret(fresh, event.user_id), expires_at: new Date(Date.now() + 365 * 86400000).toISOString() };
    const saved = existing.data
      ? await db.from('appointment_manage_tokens').update(fields).eq('event_id', event.id).eq('expires_at', existing.data.expires_at)
      : await db.from('appointment_manage_tokens').upsert(fields, { onConflict: 'event_id', ignoreDuplicates: true });
    if (saved.error) throw databaseError(saved.error);
    const current = await db.from('appointment_manage_tokens').select('token_secret').eq('event_id', event.id).single();
    if (current.error) throw databaseError(current.error);
    token = openGmailSecret(current.data.token_secret, event.user_id);
  }
  return new URL(`/appointments/manage/${token}`, calendarCallbackUrl().origin).href;
}
export async function sendAppointmentNotification(
  db: SupabaseClient, actor: string, eventId: string, conversation: string, requestedKind?: unknown,
): Promise<{ id: string; provider?: 'gmail'; status?: string; message: string; kind: AppointmentNotificationKind }> {
  const event = await ownedAppointment(db, actor, eventId), lock = randomUUID();
  const kind = appointmentNotificationKind(event), attemptId = appointmentAttemptId(event, kind);
  const claimed = await db.rpc('claim_appointment_notification', { p_id: eventId, p_user: actor, p_revision: event.revision, p_lock: lock });
  if (claimed.error) throw databaseError(claimed.error);
  try {
    const pending = await db.from('appointment_notifications').upsert({
      event_id: event.id, revision: event.revision, kind, attempt_id: attemptId, status: 'pending', last_error: null,
    }, { onConflict: 'event_id,revision,kind', ignoreDuplicates: true });
    if (pending.error) throw databaseError(pending.error);
    const result = await deliverAppointmentNotification(db, actor, event, conversation, requestedKind);
    const saved = await db.from('appointment_notifications').update({ status: 'sent', communication_id: result.id, last_error: null, updated_at: new Date().toISOString() })
      .eq('event_id', event.id).eq('revision', event.revision).eq('kind', kind);
    if (saved.error) throw databaseError(saved.error);
    return result;
  } catch (error) {
    const saved = await db.from('appointment_notifications').update({
      status: 'failed', last_error: error instanceof WorkspaceError ? error.message : 'Appointment saved, but notification failed. Review Gmail before retrying.', updated_at: new Date().toISOString(),
    }).eq('event_id', event.id).eq('revision', event.revision).eq('kind', kind).neq('status', 'sent');
    if (saved.error) console.error('[appointments/notification-state]', saved.error.code);
    throw error;
  } finally {
    const released = await db.from('events').update({ sync_lock: null, sync_lease_until: null }).eq('id', event.id).eq('sync_lock', lock);
    if (released.error) console.error('[appointments/notification-lease]', released.error.code);
  }
}
async function deliverAppointmentNotification(
  db: SupabaseClient, actor: string, event: Appointment, conversation: string, requestedKind?: unknown,
): Promise<{ id: string; provider?: 'gmail'; status?: string; message: string; kind: AppointmentNotificationKind }> {
  const ref = parseConversationKey(conversation);
  if (!ref || ref.kind === 'unmatched' || !(ref.kind === event.related_type && ref.id === event.related_id)
    && !(ref.kind === 'client' && ref.id === event.client_id)) {
    throw new WorkspaceError('This appointment is not linked to this contact.', 409);
  }
  if (event.status === 'completed') throw new WorkspaceError('Completed appointments cannot send booking notifications.', 409);
  const kind = appointmentNotificationKind(event);
  if (requestedKind !== undefined && requestedKind !== kind) throw new WorkspaceError('This appointment changed. Refresh before sending its current notification.', 409);
  if ((event.meeting_type === 'google_meet' || event.meeting_type === 'zoom' || event.calendar_sync || event.google_event_id || event.zoom_meeting_id || event.zoom_create_attempted_at)
    && (event.sync_status !== 'synced' && event.sync_status !== 'not_required'
      || event.status !== 'cancelled' && (event.meeting_type === 'google_meet' && !event.google_meet_url || event.meeting_type === 'zoom' && !event.zoom_join_url))) {
    throw new WorkspaceError('The appointment is saved, but its meeting or calendar update is not ready. Retry calendar sync before sending notification.', 409);
  }
  const facts = await salesFacts(db, actor, conversation);
  const attemptId = appointmentAttemptId(event, kind);
  const old = await db.from('agent_email_attempts').select('user_id,status,communication_id').eq('id', attemptId).maybeSingle();
  if (old.error) throw databaseError(old.error);
  if (old.data && old.data.user_id !== actor) throw new WorkspaceError('Another agent already initiated this appointment notification. Review the conversation; do not resend.', 409);
  if (old.data?.status === 'recorded') return { message: 'Appointment notification was already accepted by Gmail.', id: old.data.communication_id, kind };
  const manage = await appointmentManageUrl(db, event);
  const details = appointmentDetails(event, event.time_zone);
  let subject: string, body: string, templateIdentity: { id: string; revision: number } | undefined;
  if (kind === 'cancelled') {
    subject = 'Appointment cancelled';
    body = `Hello ${facts.contact_name ?? 'there'},\n\nYour appointment has been cancelled:\n${details}\n\nNo meeting will take place. Contact your agent to book another appointment.\n\nView appointment: ${manage}`;
  } else {
    const template = (await listSalesTemplates(db)).find((row) => row.id === 'appointment_confirmation' && !row.archived);
    if (!template) throw new WorkspaceError('The appointment confirmation template is unavailable. Restore it before sending.', 409);
    const rendered = renderSalesTemplate(template, 'email', { ...facts, appointment_details: details });
    if (rendered.missing.length) throw new WorkspaceError(`Complete the appointment details: ${rendered.missing.join(', ')}.`, 409);
    templateIdentity = { id: template.id, revision: template.revision };
    subject = kind === 'rescheduled' ? 'Appointment updated' : rendered.subject;
    body = `${kind === 'rescheduled' ? 'Your appointment has been updated.\n\n' : ''}${rendered.body}\n\nCancel appointment: ${manage}?action=cancel\nReschedule appointment: ${manage}?action=reschedule`;
  }
  const recipient = await resolveOutboundEmailRecipient(db, { conversationKey: conversation });
  if (!recipient.ok) throw new WorkspaceError(recipient.message, recipient.status);
  // Recheck the revision immediately before sending. The send-attempt identity
  // also prevents automatic retries after uncertain Gmail acceptance.
  const current = await ownedAppointment(db, actor, event.id);
  if (current.revision !== event.revision) throw new WorkspaceError('The appointment changed. Refresh before sending.', 409);
  const result = await sendAgentEmail(db, actor, { to: recipient.recipient.to, subject, body }, {
      attemptId, clientId: recipient.recipient.clientId, leadId: recipient.recipient.leadId,
      ...(templateIdentity ? { salesTemplate: templateIdentity } : {}),
    });
  return { message: 'Appointment saved and notification accepted by Gmail.', ...result, kind };
}
