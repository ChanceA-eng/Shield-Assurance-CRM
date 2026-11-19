import { randomUUID } from 'node:crypto';
import { ResendSendError, resendConfiguration, sendResendEmail } from '@crm/shared/resend';
import { DEFAULT_EMAIL_DESIGN, type EmailDesign } from '@crm/shared';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { assertSameOriginJson, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { WorkspaceError } from '../../../lib/record-scope';
import { isRecord, isUuid } from '../../../lib/workspace-validation';
import { parseQuestionnaire, QUESTION_FIELDS } from '../../../lib/prospect-questionnaires';
import { prospectDb, prospectHash, prospectJson, prospectRpc, prospectToken, requireProspectUploads } from '../../../lib/prospect-questionnaire-server';
import { sendAgentEmail } from '../../../lib/agent-email';
import { resolveIntakeInvitationRecipient } from '../../../lib/message-delivery';
import { appendPersonalSignature } from '../../../lib/agency-signature';

async function handle(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) return session.error;
    const db = prospectDb();
    const action = request.method === 'GET' ? request.nextUrl.searchParams.get('action') ?? 'templates' : (await workspaceBody(request));
    const body = typeof action === 'string' ? Object.fromEntries(request.nextUrl.searchParams) : action;
    const operation = typeof action === 'string' ? action : body.action;
    if (request.method !== 'GET') assertSameOriginJson(request);
    if (typeof operation !== 'string' || !['templates', 'requests', 'context', 'save_template', 'create_request', 'rotate', 'reopen', 'revoke', 'review', 'invitation'].includes(operation)
      || (request.method === 'GET' && !['templates', 'requests', 'context'].includes(operation))) {
      throw new WorkspaceError('Choose a questionnaire action.', 400);
    }
    let data: Record<string, unknown> = { ...body };
    let token: string | null = null;
    if (operation === 'invitation') {
      if (!isUuid(body.id) || !isUuid(body.request_id) || typeof body.token !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || !['default', 'gmail'].includes(String(body.email_provider))) {
        throw new WorkspaceError('Choose a current request link, sender and stable send identity.', 400);
      }
      data = { id: body.id, token_hash: prospectHash(body.token) };
    }
    if (operation === 'save_template') {
      if (!isUuid(body.id) || !Number.isInteger(body.expected) || Number(body.expected) < 0
        || (body.source_id != null && !isUuid(body.source_id))) throw new WorkspaceError('Provide a template identity and revision.', 400);
      data.design = parseQuestionnaire(body.design);
    }
    if (operation === 'create_request') {
      const design = parseQuestionnaire(body.design);
      if (design.questions.some((question) => question.type === 'file')) requireProspectUploads();
      if (!isUuid(body.template_id) || typeof body.recipient !== 'string'
        || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(body.recipient) || body.recipient.length > 254
        || typeof body.recipient_name !== 'string' || !body.recipient_name.trim() || body.recipient_name.length > 120) {
        throw new WorkspaceError('Choose a template, recipient name and valid email.', 400);
      }
      data = { ...body, id: randomUUID(), design, recipient: body.recipient.trim().toLowerCase(), recipient_name: body.recipient_name.trim() };
    }
    if (operation === 'create_request' || operation === 'reopen' || operation === 'rotate') {
      token = prospectToken();
      data.token_hash = prospectHash(token);
    }
    if (['rotate', 'reopen', 'revoke', 'review'].includes(operation) && !isUuid(body.id)) throw new WorkspaceError('Choose a saved request.', 400);
    if ((operation === 'context' || body.target_id != null) && (!isUuid(body.target_id) || !['lead', 'client'].includes(String(body.target_type)))) {
      throw new WorkspaceError('Choose a valid lead or account.', 400);
    }
    if (operation === 'review' && (!isUuid(body.submission_id) || !Array.isArray(body.fields)
      || !body.fields.every((field: unknown) => QUESTION_FIELDS.some((entry) => entry === field)))) {
      throw new WorkspaceError('Choose reviewed fields to apply.', 400);
    }
    const result = await prospectRpc(db, 'prospect_questionnaire_staff', { p_actor: session.user.id, p_action: operation, p_data: data });
    if (operation === 'invitation') {
      if (!isRecord(result) || !isUuid(result.id) || typeof result.recipient !== 'string'
        || typeof result.recipient_name !== 'string' || typeof body.token !== 'string' || !isUuid(body.request_id)) {
        throw new WorkspaceError('The invitation recipient could not be verified.', 503);
      }
      const targetId = isUuid(result.target_id) ? result.target_id : null;
      const resolved = await resolveIntakeInvitationRecipient(db, {
        to: result.recipient, leadId: result.target_type === 'lead' ? targetId : null,
        clientId: result.target_type === 'client' ? targetId : null,
      });
      if (!resolved.ok) throw new WorkspaceError(resolved.message, resolved.status);
      const recipient = resolved.recipient;
      const url = new URL(`/secure-intake/${body.token}`, process.env.CRM_WEB_ORIGIN || request.nextUrl.origin);
      const subject = 'Your Shield Assurance Secure Intake';
      const message = `Hi ${result.recipient_name},\n\nPlease complete your information and requested documents using the button below.${url.protocol === 'https:' ? '' : `\n${url.href}`}\n\nEnter your first and last name, then the code we email you, to open your form.`;
      const emailDesign: EmailDesign = { ...DEFAULT_EMAIL_DESIGN, brand_name: 'Shield Assurance', heading: 'Complete your secure intake',
        ...(url.protocol === 'https:' ? { button_label: 'Open my secure form', button_url: url.href } : {}) };
      if (body.email_provider === 'gmail') {
        const sent = await sendAgentEmail(db, session.user.id, { to: recipient.to, subject, body: message, purpose: 'service', emailDesign }, {
          attemptId: body.request_id, clientId: recipient.clientId, leadId: recipient.leadId,
        });
        return prospectJson({ id: sent.id, delivery: sent.status, provider: sent.provider });
      }
      const signed = appendPersonalSignature(message, session.user.user_metadata.signature);
      try {
        await sendResendEmail({ to: recipient.to, subject, body: signed, emailDesign, purpose: 'service', requestId: body.request_id,
          clientId: recipient.clientId ?? undefined, leadId: recipient.leadId ?? undefined }, resendConfiguration(process.env));
      } catch (failure) {
        if (failure instanceof ResendSendError) throw new WorkspaceError(failure.message, failure.status);
        console.error('[questionnaire/invitation-email]', failure instanceof Error ? failure.message : 'Unknown provider failure');
        throw new WorkspaceError('Invitation acceptance could not be confirmed. Check Email delivery history in Settings before retrying this same request. Do not switch senders.', 503);
      }
      const saved = await db.from('communication_log').upsert({
        id: body.request_id, client_id: recipient.clientId, channel: 'email', direction: 'outbound',
        subject, body: signed, automation_type: 'manual', sent_at: new Date().toISOString(),
        metadata: { to: recipient.to, lead_id: recipient.leadId, provider: 'resend', delivery_status: 'accepted_by_provider',
          request_id: body.request_id, sent_by_user_id: session.user.id, questionnaire_request_id: result.id },
      }, { onConflict: 'id', ignoreDuplicates: true });
      if (saved.error) throw new WorkspaceError('The email provider accepted the invitation, but its history could not be saved. Retry only this same send request; do not generate another invitation.', 503);
      return prospectJson({ id: body.request_id, delivery: 'accepted_by_provider', provider: 'resend' });
    }
    const templateView = (value: unknown): object => {
      if (!isRecord(value) || !isUuid(value.id) || !Number.isInteger(value.revision)) throw new WorkspaceError('Template response could not be verified.', 503);
      return { ...value, ...parseQuestionnaire(value.design) };
    };
    if (operation === 'templates') {
      if (!Array.isArray(result)) throw new WorkspaceError('Template library could not be verified.', 503);
      return prospectJson(result.map(templateView));
    }
    if (operation === 'save_template') return prospectJson(templateView(result));
    return prospectJson(token ? { request: result, path: `/secure-intake/${token}` } : result);
  } catch (failure) { return workspaceApiError(failure, 'questionnaires/staff'); }
}
export const GET = handle;
export const POST = handle;
