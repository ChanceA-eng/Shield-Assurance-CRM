import { SALES_SEQUENCE_PRESETS, SALES_FIELDS, parseEmailDocument, parseEmailRows, emailContentKey, type SalesFacts, type SalesSequencePlan, type SalesTemplate } from '@crm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isRecord, isUuid } from './workspace-validation';
import { listSalesTemplates, parseSalesTemplate } from './sales-templates';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { activeAgencyMember } from './agency-membership';
import { parseOutreachSender } from './marketing-profile';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { getAgentEmailSender } from './agent-email-sender';

export function parseSalesPlan(value: unknown): SalesSequencePlan {
  if (!isRecord(value) || typeof value.actor !== 'string' || typeof value.preset !== 'string'
    || !Object.hasOwn(SALES_SEQUENCE_PRESETS, value.preset) || typeof value.stage !== 'string'
    || !Array.isArray(value.steps) || value.steps.length < 2 || !isRecord(value.sender)
    || typeof value.sender.name !== 'string' || typeof value.sender.signature !== 'string'
    || typeof value.recipient !== 'string' || !isRecord(value.facts) || typeof value.auto_send !== 'boolean'
    || !value.steps.every((step) => isRecord(step) && isRecord(step.template)
      && typeof step.template.id === 'string' && typeof step.template.revision === 'number'
      && typeof step.subject === 'string' && typeof step.body === 'string' && typeof step.requires_review === 'boolean')) {
    throw new WorkspaceError('The sales sequence plan is invalid. Review and recreate it.', 409);
  }
  const preset = (Object.keys(SALES_SEQUENCE_PRESETS) as Array<keyof typeof SALES_SEQUENCE_PRESETS>).find((key) => key === value.preset);
  if (!preset || (value.assigned_agent !== null && typeof value.assigned_agent !== 'string')) throw new WorkspaceError('Invalid sales assignment.', 409);
  const facts: SalesFacts = {};
  for (const field of SALES_FIELDS) {
    const text = value.facts[field];
    if (text !== undefined && typeof text !== 'string') throw new WorkspaceError('Invalid sales facts.', 409);
    if (typeof text === 'string') facts[field] = text;
  }
  let evidence: SalesSequencePlan['evidence'] = null;
  if (value.evidence !== null) {
    if (!isRecord(value.evidence) || !['appointment', 'quote'].includes(String(value.evidence.type))
      || !isUuid(value.evidence.id) || typeof value.evidence.version !== 'string') throw new WorkspaceError('Invalid sequence evidence.', 409);
    evidence = { type: value.evidence.type === 'appointment' ? 'appointment' : 'quote', id: value.evidence.id, version: value.evidence.version };
  }
  return { actor: value.actor, preset, stage: value.stage, assigned_agent: value.assigned_agent, recipient: value.recipient,
    sender: { ...parseOutreachSender(value.sender, 2000),
      signatureDocument: parseEmailDocument(value.sender.signatureDocument), signatureRows: parseEmailRows(value.sender.signatureRows) },
    facts, auto_send: value.auto_send, evidence,
    steps: value.steps.map((step: unknown) => {
      if (!isRecord(step) || typeof step.subject !== 'string' || typeof step.body !== 'string' || typeof step.requires_review !== 'boolean') {
        throw new WorkspaceError('Invalid sequence step.', 409);
      }
      return { subject: step.subject, body: step.body, requires_review: step.requires_review, template: parseSalesTemplate(step.template) };
    }) };
}
export async function salesSequenceBlock(db: SupabaseClient, leadId: string, value: unknown, enrolledAt?: string): Promise<string | null> {
  const plan = parseSalesPlan(value);
  try { await activeAgencyMember(db, plan.actor); }
  catch (error) {
    if (error instanceof WorkspaceError && error.status === 403) return 'Sequence owner is no longer an active agency member.';
    throw error;
  }
  const lead = await db.from('leads').select('status,email,agent_user_id,archived_at,account_id').eq('id', leadId).maybeSingle();
  if (lead.error) throw databaseError(lead.error);
  if (!lead.data || lead.data.archived_at || ['won', 'lost'].includes(lead.data.status)) return 'Lead is archived, closed or unavailable.';
  if (lead.data.status !== plan.stage || (lead.data.agent_user_id ?? null) !== plan.assigned_agent) return 'Lead stage or assignment changed. Review and recreate this sales sequence.';
  if (lead.data.email?.trim().toLowerCase() !== plan.recipient) return 'Recipient changed. Review this sales sequence.';
  let sender: SalesSequencePlan['sender'];
  try { sender = await getAgentEmailSender(db, plan.actor); }
  catch (error) {
    if (error instanceof WorkspaceError && [403, 409].includes(error.status)) return error.message;
    throw error;
  }
  if (emailContentKey(sender) !== emailContentKey(plan.sender)) return 'Sender profile changed. Review and recreate this sales sequence.';
  const target = await resolveOutboundEmailRecipient(db, { leadId, to: plan.recipient });
  if (!target.ok) return target.message;
  const permission = await db.from('marketing_email_consents').select('revoked_at').eq('email', plan.recipient).maybeSingle();
  if (permission.error) throw databaseError(permission.error);
  if (permission.data?.revoked_at) return 'This recipient declined marketing email.';
  const templates = await listSalesTemplates(db);
  if (plan.steps.some((step) => !templates.some((row) => row.id === step.template.id && row.revision === step.template.revision && !row.archived))) {
    return 'A shared template changed or was archived. Review and recreate the sequence to approve its new revision.';
  }
  const overlap = await db.from('scheduled_messages').select('id').in('status', ['pending', 'processing'])
    .or(`lead_id.eq.${leadId},approved_recipient.eq."${plan.recipient.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"${lead.data.account_id ? `,client_id.eq.${lead.data.account_id}` : ''}`).limit(1);
  if (overlap.error) throw databaseError(overlap.error);
  if (overlap.data?.length) return 'A manual communication is scheduled. Review the overlap before continuing this sequence.';
  if (enrolledAt) {
    const messages = await db.from('canonical_communications').select('id').in('conversation_key',
      [`lead:${leadId}`, ...(lead.data.account_id ? [`client:${lead.data.account_id}`] : [])])
      .eq('direction', 'inbound').gt('sent_at', enrolledAt).limit(1);
    if (messages.error) throw databaseError(messages.error);
    if (messages.data?.length) return 'The contact replied. Continue personally rather than resuming this sequence.';
  }
  if (plan.evidence) {
    const event = plan.evidence.type === 'appointment'
      ? await db.from('events').select('id,status,updated_at,related_type,related_id').eq('id', plan.evidence.id).maybeSingle()
      : await db.from('quote_options').select('id,status,updated_at,lead_id').eq('id', plan.evidence.id).maybeSingle();
    if (event.error) throw databaseError(event.error);
    if (!event.data || event.data.updated_at !== plan.evidence.version
      || (plan.evidence.type === 'appointment' ? event.data.status !== 'completed' : !['presented', 'accepted'].includes(event.data.status))) {
      return 'The supporting appointment or quote changed. Review and recreate the sequence.';
    }
  }
  return null;
}
export async function sequenceEvidence(db: SupabaseClient, leadId: string, preset: keyof typeof SALES_SEQUENCE_PRESETS, id: unknown): Promise<SalesSequencePlan['evidence']> {
  const type = SALES_SEQUENCE_PRESETS[preset].requires;
  if (!type) return null;
  if (!isUuid(id)) throw new WorkspaceError(`Choose the CRM ${type} record before enrolling.`, 400);
  if (type === 'appointment') {
    const row = await db.from('events').select('id,updated_at').eq('id', id).eq('related_type', 'lead').eq('related_id', leadId).eq('status', 'completed').maybeSingle();
    if (row.error) throw databaseError(row.error);
    if (!row.data) throw new WorkspaceError('Choose a completed appointment on this lead.', 409);
    return { type, id, version: row.data.updated_at };
  }
  const row = await db.from('quote_options').select('id,updated_at').eq('id', id).eq('lead_id', leadId).in('status', ['presented', 'accepted']).maybeSingle();
  if (row.error) throw databaseError(row.error);
  if (!row.data) throw new WorkspaceError('Choose a presented quote on this lead.', 409);
  return { type, id, version: row.data.updated_at };
}
export function sequenceTemplate(templates: SalesTemplate[], id: string): SalesTemplate {
  const template = templates.find((row) => row.id === id && !row.archived);
  if (!template) throw new WorkspaceError(`Restore or replace the sequence template: ${id}.`, 409);
  return template;
}
