import {
  DEFAULT_OUTREACH_SENDER, EMPTY_MARKETING_PROFILE, isOutreachTemplate,
  type MarketingProfile, type OutreachSender, type RecordTarget,
} from '@crm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isRecord } from './workspace-validation';
import { resolveRecordScope, WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';

function strings<T extends object>(value: unknown, defaults: T, maxLength: number): T {
  if (!isRecord(value)) throw new WorkspaceError('Send a profile object.', 400);
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const field = value[key];
    if (typeof field !== 'string' || field.length > maxLength) {
      throw new WorkspaceError(`${key} must be text of at most ${maxLength} characters.`, 400);
    }
    Object.assign(result, { [key]: field.trim() });
  }
  return result;
}

export function parseMarketingProfile(value: unknown): MarketingProfile {
  const profile = strings(value, EMPTY_MARKETING_PROFILE, 1000);
  if (!isOutreachTemplate(profile.template)) throw new WorkspaceError('Choose a valid email template.', 400);
  if (!['unknown', 'email', 'phone', 'sms'].includes(profile.preferred_channel)) throw new WorkspaceError('Choose a valid contact channel.', 400);
  if (profile.confirmed_on && (!/^\d{4}-\d{2}-\d{2}$/.test(profile.confirmed_on)
    || !Number.isFinite(Date.parse(profile.confirmed_on))
    || new Date(profile.confirmed_on).toISOString().slice(0, 10) !== profile.confirmed_on
    || profile.confirmed_on > new Date().toISOString().slice(0, 10))) {
    throw new WorkspaceError('Choose a valid confirmation date, not in the future.', 400);
  }
  if (([profile.interests, profile.priorities, profile.objections, profile.next_step].some(Boolean) || profile.preferred_channel !== 'unknown')
    && (!profile.source || !profile.confirmed_on)) {
    throw new WorkspaceError('Record the source and confirmation date for these stated needs.', 400);
  }
  return profile;
}

export function parseOutreachSender(value: unknown): OutreachSender {
  const sender = strings(value, DEFAULT_OUTREACH_SENDER, 1000);
  if (!sender.name || !sender.agency || !sender.signature) throw new WorkspaceError('Sender name, agency and signature are required.', 400);
  return sender;
}

export async function getOutreachSender(supabase: SupabaseClient): Promise<OutreachSender> {
  const { data, error } = await supabase.from('outreach_settings').select('sender_profile').eq('id', 1).single();
  if (error) throw databaseError(error);
  return parseOutreachSender(data.sender_profile);
}

export async function getMarketingProfile(supabase: SupabaseClient, target: RecordTarget): Promise<MarketingProfile> {
  const scope = await resolveRecordScope(supabase, target);
  // An explicit account link shares account preferences without guessing identity.
  const leadIds = new Set(scope.leadId ? [scope.leadId] : []);
  if (scope.clientId) {
    for (let offset = 0; ; offset += 100) {
      const linked = await supabase.from('leads').select('id').eq('account_id', scope.clientId).order('id').range(offset, offset + 99);
      if (linked.error) throw databaseError(linked.error);
      for (const lead of linked.data ?? []) leadIds.add(lead.id);
      if ((linked.data ?? []).length < 100) break;
    }
  }
  const filters = [...Array.from(leadIds, (id) => `lead_id.eq.${id}`), scope.clientId ? `client_id.eq.${scope.clientId}` : ''].filter(Boolean);
  const { data, error } = await supabase.from('outreach_marketing_profiles').select('client_id,profile')
    .or(filters.join(',')).order('updated_at', { ascending: false }).order('id');
  if (error) throw databaseError(error);
  const row = data?.find((item) => item.client_id === scope.clientId && scope.clientId) ?? data?.[0];
  return row ? parseMarketingProfile(row.profile) : { ...EMPTY_MARKETING_PROFILE };
}

export async function saveMarketingProfile(supabase: SupabaseClient, target: RecordTarget, value: unknown): Promise<MarketingProfile> {
  const profile = parseMarketingProfile(value);
  const scope = await resolveRecordScope(supabase, target);
  const key = scope.clientId ? 'client_id' : 'lead_id';
  const { error } = await supabase.from('outreach_marketing_profiles')
    .upsert({ [key]: scope.clientId ?? scope.leadId, profile, updated_at: new Date().toISOString() }, { onConflict: key });
  if (error) throw databaseError(error);
  return profile;
}
