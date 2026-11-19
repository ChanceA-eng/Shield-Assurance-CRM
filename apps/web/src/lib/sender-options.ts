import type { OutreachSender } from '@crm/shared';

export type SenderOptions = Partial<Record<keyof OutreachSender, string[]>>;

export const SENDER_JOB_TITLES = [
  'Insurance producer',
  'Account manager',
  'Client service representative',
  'Commercial lines specialist',
  'Personal lines specialist',
  'Agency manager',
  'Agency principal',
] as const;

export function senderOptions(profiles: OutreachSender[], displayName?: string): SenderOptions {
  const options: SenderOptions = {};
  for (const key of ['name', 'role', 'agency', 'service_area', 'specialties', 'tone'] as const) {
    const values = profiles.map((profile) => profile[key]).filter((value) => value.trim() && !/[\r\n]/.test(value));
    if (key === 'name' && displayName?.trim() && !/[\r\n]/.test(displayName)) values.push(displayName.trim());
    options[key] = [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }
  return options;
}
