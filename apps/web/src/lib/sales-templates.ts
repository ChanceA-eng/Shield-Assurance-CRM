import { SALES_TEMPLATES, salesTemplateErrors, renderSalesTemplate, hasUnresolvedSalesFields,
  SALES_FIELDS, parseEmailDesign, emailDesignErrors, type SalesTemplateSnapshot, type SalesTemplate, type SalesFacts, type SalesCategory } from '@crm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';
import { activeAgencyMember, agencyEnabled, agentSender } from './agency-membership';
import { getOutreachSender, getMarketingProfile } from './marketing-profile';
import { parseConversationKey } from './conversations';
import { websiteBusinessDetails } from './website-intake';
import type { BusinessResearchProfile } from '@crm/shared';
import { prospectingEvidence } from './prospecting-evidence';

export async function listSalesTemplates(db: SupabaseClient): Promise<SalesTemplate[]> {
  const result = await db.from('sales_templates').select('id,name,category,subject,email_body,sms_body,email_design,revision,archived');
  if (result.error?.code === '42703' || result.error?.code === 'PGRST204') {
    console.error('[sales-templates/schema]', result.error.code, result.error.message);
    throw new WorkspaceError('Email templates need a database update. Ask your administrator to apply migration 20261112010000_branded_email_templates, then reload.', 503);
  }
  if (result.error) throw databaseError(result.error);
  const saved = new Map((result.data ?? []).map((row) => [row.id, row]));
  return [...SALES_TEMPLATES.map((template) => ({ ...template, ...saved.get(template.id) })),
    ...(result.data ?? []).filter((row) => !SALES_TEMPLATES.some((template) => template.id === row.id))
      .map((row) => ({ ...row, builtin: false }))].map((row) => parseSalesTemplate(row));
}
export function parseSalesTemplate(value: unknown): SalesTemplate {
  if (!isRecord(value) || typeof value.id !== 'string' || !/^[a-z][a-z0-9_]{0,79}$/.test(value.id)
    || !['name', 'category', 'subject', 'email_body', 'sms_body'].every((key) => typeof value[key] === 'string')
    || !Number.isSafeInteger(value.revision) || typeof value.revision !== 'number' || value.revision < 0
    || typeof value.archived !== 'boolean') throw new WorkspaceError('Provide valid template fields and revision.', 400);
  const template: SalesTemplate = {
    id: value.id, name: String(value.name), category: value.category as SalesCategory, subject: String(value.subject),
    email_body: String(value.email_body), sms_body: String(value.sms_body), revision: value.revision,
    archived: value.archived, builtin: SALES_TEMPLATES.some((item) => item.id === value.id),
  };
  const designErrors = emailDesignErrors(value.email_design);
  if (designErrors.length) throw new WorkspaceError(designErrors.join(' '), 400);
  const design = parseEmailDesign(value.email_design);
  if (design) template.email_design = design;
  const errors = salesTemplateErrors(template);
  if (errors.length) throw new WorkspaceError(errors.join(' '), 400);
  return template;
}
export async function salesFacts(db: SupabaseClient, actor: string, key: string): Promise<SalesFacts> {
  const ref = parseConversationKey(key);
  if (!ref) throw new WorkspaceError('Choose a contact or conversation.', 400);
  await activeAgencyMember(db, actor);
  const sender = agencyEnabled() ? await agentSender(db, actor) : await getOutreachSender(db);
  const facts: SalesFacts = { agent_name: sender.name, agency_name: sender.agency };
  if (ref.kind === 'unmatched') return facts;
  const record = ref.kind === 'lead'
    ? await db.from('leads').select('id,full_name,business,form_payload,agent_user_id,archived_at').eq('id', ref.id).maybeSingle()
    : await db.from('clients').select('id,full_name,agent_user_id').eq('id', ref.id).maybeSingle();
  if (record.error) throw databaseError(record.error);
  if (!record.data) {
    throw new WorkspaceError('Contact not found or unavailable.', 404);
  }
  if ('archived_at' in record.data && record.data.archived_at) throw new WorkspaceError('Restore this lead before composing.', 409);
  facts.contact_name = record.data.full_name;
  const savedBusinessName = 'business' in record.data && typeof record.data.business === 'string' ? record.data.business.trim() : '';
  const payload = 'form_payload' in record.data && isRecord(record.data.form_payload) ? record.data.form_payload : {};
  const profileBusinessName = websiteBusinessDetails(payload).businessName;
  const businessName = savedBusinessName || profileBusinessName;
  if (businessName) facts.business_name = businessName;
  const profile = await getMarketingProfile(db, { type: ref.kind, id: ref.id });
  if (profile.confirmed_on && profile.source) {
    if (profile.interests) facts.insurance_interest = profile.interests;
    if (profile.next_step) facts.next_step = profile.next_step;
  }
  const research = await db.rpc('get_record_business_research', { p_actor: actor, p_type: ref.kind, p_id: ref.id })
    .single<BusinessResearchProfile>();
  if (research.error) throw databaseError(research.error);
  const evidence = prospectingEvidence(research.data);
  if (evidence[0]) {
    facts.prospecting_signal = evidence[0].text;
    facts.specific_offer = evidence[0].source === 'FMCSA Census'
      ? 'a short checklist of vehicle and driver details to have ready for a commercial-auto review'
      : 'a short checklist tailored to your business category to help organize an insurance review';
  }
  return facts;
}
export async function suggestedSalesTemplates(db: SupabaseClient, key: string, facts: SalesFacts = {}): Promise<string[]> {
  const ref = parseConversationKey(key);
  if (!ref) return [];
  const messages = await db.from('canonical_communications').select('direction').eq('conversation_key', key)
    .order('sent_at', { ascending: false }).limit(1);
  if (messages.error) throw databaseError(messages.error);
  if (messages.data?.[0]?.direction === 'inbound') return ['inquiry_response', 'information_request'];
  if (ref.kind === 'lead' && !messages.data?.length) {
    return [facts.prospecting_signal ? 'cold_first_touch_evidence' : 'cold_first_touch_question'];
  }
  return messages.data?.length ? ['information_request', 'close_loop'] : ['introduction'];
}
export function mergeSalesFacts(base: SalesFacts, input: unknown): SalesFacts {
  if (!isRecord(input)) throw new WorkspaceError('Confirm the required template details.', 400);
  const facts = { ...base };
  for (const field of SALES_FIELDS) {
    if (field === 'agent_name' || field === 'agency_name') continue;
    if (input[field] !== undefined) {
      if (typeof input[field] !== 'string' || input[field].length > 2000 || hasUnresolvedSalesFields(input[field])) {
        throw new WorkspaceError('Template details must be plain text of at most 2,000 characters, without merge fields.', 400);
      }
      if (field === 'quote_link' && input[field] && !/^https:\/\/[^\s<>]+$/i.test(input[field])) {
        throw new WorkspaceError('Use a verified HTTPS quote link.', 400);
      }
      if (input[field].trim()) facts[field] = input[field].trim();
    }
  }
  return facts;
}
export async function templateSnapshot(db: SupabaseClient, value: unknown): Promise<SalesTemplateSnapshot | null> {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.revision !== 'number') throw new WorkspaceError('Choose a valid saved template revision.', 400);
  const template = (await listSalesTemplates(db)).find((row) => row.id === value.id && row.revision === value.revision && !row.archived);
  if (!template) throw new WorkspaceError('The template changed or was archived. Review the current template before sending.', 409);
  const designErrors = emailDesignErrors(value.email_design);
  if (designErrors.length || JSON.stringify(parseEmailDesign(value.email_design)) !== JSON.stringify(template.email_design)) {
    throw new WorkspaceError('The template design changed. Apply the saved template again before sending.', 409);
  }
  return { id: template.id, revision: template.revision, ...(template.email_design ? { email_design: template.email_design } : {}) };
}
export { renderSalesTemplate };
