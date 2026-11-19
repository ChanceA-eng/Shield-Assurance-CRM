import type { SupabaseClient } from '@supabase/supabase-js';
import { validateAutomationConfiguration, type BuiltInAutomationDefaults } from '@crm/shared';
import type { OutreachSettings } from './outreach-engine';
import { parseOutreachSender } from './marketing-profile';
import { isRecord } from './workspace-validation';
import { databaseError } from './workspace-api';
import { DEFAULT_AGENCY_TIME_ZONE, isAgencyTimeZone, type AgencyTimeZone } from './agency-time';

export interface AutomationSettingsSnapshot {
  schema_version: 1;
  automation: BuiltInAutomationDefaults;
  outreach: OutreachSettings;
}

export interface AutomationSettingsVersion {
  revision: number;
  actor_id: string | null;
  recorded_at: string;
  configuration: AutomationSettingsSnapshot;
}

export function parseAutomationSnapshot(value: unknown): AutomationSettingsSnapshot {
  if (!isRecord(value) || value.schema_version !== 1
    || !isRecord(value.outreach)) throw new Error('The automation configuration version is unsupported. Contact your administrator.');
  const outreach = value.outreach;
  const integer = (field: string, min: number, max: number): number => {
    const number = outreach[field];
    if (typeof number !== 'number' || !Number.isInteger(number) || number < min || number > max) throw new Error('Saved sending limits are invalid. Contact your administrator.');
    return number;
  };
  if (typeof outreach.approval_mode !== 'boolean' || typeof outreach.opt_out_footer !== 'string' || !isRecord(outreach.sender_profile)) {
    throw new Error('Saved sending settings are incomplete. Contact your administrator.');
  }
  const start = integer('send_window_start', 0, 23);
  const end = integer('send_window_end', 1, 24);
  if (start >= end) throw new Error('Saved sending hours are invalid. Contact your administrator.');
  const timezone = outreach.timezone ?? DEFAULT_AGENCY_TIME_ZONE;
  if (!isAgencyTimeZone(timezone)) throw new Error('Saved agency time zone is invalid. Contact your administrator.');
  return {
    schema_version: 1, automation: validateAutomationConfiguration(value.automation),
    outreach: {
      approval_mode: outreach.approval_mode, daily_send_cap: integer('daily_send_cap', 1, 200),
      send_window_start: start, send_window_end: end, timezone, opt_out_footer: outreach.opt_out_footer,
      sender_profile: parseOutreachSender(outreach.sender_profile),
    },
  };
}

export async function getAutomationSettings(db: SupabaseClient): Promise<{ revision: number; configuration: AutomationSettingsSnapshot }> {
  const { data, error } = await db.from('outreach_settings')
    .select('configuration_revision,automation_configuration,approval_mode,daily_send_cap,send_window_start,send_window_end,timezone,opt_out_footer,sender_profile')
    .eq('id', 1).single();
  if (error) throw databaseError(error);
  if (!isRecord(data) || typeof data.configuration_revision !== 'number' || !Number.isInteger(data.configuration_revision)
    || data.configuration_revision < 1 || data.configuration_revision > 2147483647) throw new Error('Saved settings revision is invalid. Contact your administrator.');
  return {
    revision: data.configuration_revision,
    configuration: parseAutomationSnapshot({ schema_version: 1, automation: data.automation_configuration, outreach: data }),
  };
}

export async function getAgencyTimeZone(db: SupabaseClient): Promise<AgencyTimeZone> {
  const { data, error } = await db.from('outreach_settings').select('timezone').eq('id', 1).single();
  if (error) throw databaseError(error);
  if (!isRecord(data) || !isAgencyTimeZone(data.timezone)) throw new Error('Saved agency time zone is invalid. Contact your administrator.');
  return data.timezone;
}
