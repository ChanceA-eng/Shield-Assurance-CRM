import { WorkspaceError } from './record-scope';

const API_ORIGIN = 'https://api.instantly.ai/api/v2';
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function instantlyAllowedSenderDomains(): string[] {
  const values = (process.env.INSTANTLY_ALLOWED_SENDER_DOMAINS ?? '').split(',').map((domain) => domain.trim().toLowerCase()).filter(Boolean);
  if (!values.every((domain) => DOMAIN_PATTERN.test(domain))) return [];
  return Array.from(new Set(values));
}

export interface InstantlyCampaignStep {
  subject: string;
  body: string;
  delay_days: number;
}

export interface InstantlyCampaignInput {
  name: string;
  senderAccounts: string[];
  dailyLimit: number;
  steps: InstantlyCampaignStep[];
}

export interface InstantlyLeadInput {
  email: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  phone: string | null;
  website: string | null;
  personalizedSubject: string;
  personalizedBody: string;
  unsubscribeUrl: string;
}

export class InstantlyApiError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'InstantlyApiError';
  }
}

export function instantlyConfiguration(): {
  apiKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  unsubscribeConfigured: boolean;
  senderDomainsConfigured: boolean;
  issues: string[];
  ready: boolean;
} {
  const apiKeyConfigured = Boolean(process.env.INSTANTLY_API_KEY?.trim());
  const webhookSecretConfigured = (process.env.INSTANTLY_WEBHOOK_SECRET?.trim().length ?? 0) >= 32;
  const issues: string[] = [];
  if (!apiKeyConfigured) issues.push('Set INSTANTLY_API_KEY in the web deployment environment.');
  if (!webhookSecretConfigured) issues.push('Set INSTANTLY_WEBHOOK_SECRET to a private random value of at least 32 characters.');
  let secureOriginConfigured = false;
  try {
    const origin = new URL(process.env.CRM_WEB_ORIGIN?.trim() ?? '');
    secureOriginConfigured = origin.protocol === 'https:' && !origin.username && !origin.password;
  } catch {
    secureOriginConfigured = false;
  }
  if (!secureOriginConfigured) issues.push('Set CRM_WEB_ORIGIN to the public HTTPS address of this CRM.');
  const postalAddressConfigured = Boolean(process.env.EMAIL_POSTAL_ADDRESS?.trim());
  if (!postalAddressConfigured) issues.push('Set EMAIL_POSTAL_ADDRESS to the complete business mailing address.');
  const unsubscribeSecretConfigured = (process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim().length ?? 0) >= 32;
  if (!unsubscribeSecretConfigured) issues.push('Set EMAIL_UNSUBSCRIBE_SECRET to a stable private value of at least 32 characters.');
  const unsubscribeConfigured = secureOriginConfigured && postalAddressConfigured && unsubscribeSecretConfigured;
  const rawDomains = (process.env.INSTANTLY_ALLOWED_SENDER_DOMAINS ?? '').split(',').map((domain) => domain.trim()).filter(Boolean);
  const senderDomainsConfigured = rawDomains.length > 0 && rawDomains.every((domain) => DOMAIN_PATTERN.test(domain));
  if (!senderDomainsConfigured) issues.push('Set INSTANTLY_ALLOWED_SENDER_DOMAINS to one or more dedicated campaign-mailbox domains.');
  return {
    apiKeyConfigured,
    webhookSecretConfigured,
    unsubscribeConfigured,
    senderDomainsConfigured,
    issues,
    ready: issues.length === 0,
  };
}

function credentials(): { apiKey: string; webhookSecret: string } {
  const key = process.env.INSTANTLY_API_KEY?.trim();
  if (!key) throw new WorkspaceError('Instantly is not connected. Ask your administrator to configure the provider API key.', 503);
  const webhookSecret = process.env.INSTANTLY_WEBHOOK_SECRET?.trim() ?? '';
  if (webhookSecret.length < 32) throw new WorkspaceError('Configure INSTANTLY_WEBHOOK_SECRET with at least 32 random characters before setting up campaigns.', 503);
  return { apiKey: key, webhookSecret };
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const { apiKey } = credentials();
  let response: Response;
  try {
    response = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
      signal: AbortSignal.timeout(15000),
      cache: 'no-store',
    });
  } catch {
    throw new InstantlyApiError('Instantly did not confirm the request. Check the provider before retrying.', null);
  }

  if (!response.ok) {
    throw new InstantlyApiError(`Instantly rejected the request (HTTP ${response.status}).`, response.status);
  }
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new InstantlyApiError('Instantly returned an unreadable response.', response.status);
  }
}

export function campaignRequestBody(input: InstantlyCampaignInput, postalAddress: string): Record<string, unknown> {
  const footer = `<br/><br/>Shield Assurance<br/>${escapeHtml(postalAddress.trim())}<br/><a href="{{crm_unsubscribe_url}}">Unsubscribe</a>`;
  return {
    name: input.name,
    campaign_schedule: {
      schedules: [{
        name: 'Weekdays',
        timing: { from: '08:00', to: '17:00' },
        days: { '0': false, '1': true, '2': true, '3': true, '4': true, '5': true, '6': false },
        timezone: 'America/Phoenix',
      }],
    },
    sequences: [{
      steps: input.steps.map((step) => ({
        type: 'email',
        delay: step.delay_days,
        delay_unit: 'days',
        variants: [{
          subject: step.subject,
          body: `${step.body.trim() === '{{crm_personalized_body}}' ? '{{crm_personalized_body}}' : textToHtml(step.body)}${footer}`,
        }],
      })),
    }],
    email_list: input.senderAccounts,
    daily_limit: input.dailyLimit,
    daily_max_leads: input.dailyLimit,
    stop_on_reply: true,
    stop_on_auto_reply: true,
    text_only: false,
    first_email_text_only: false,
    insert_unsubscribe_header: true,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function textToHtml(value: string): string {
  return escapeHtml(value.trim()).replace(/\r\n?|\n/g, '<br/>');
}

export function leadRequestBody(input: InstantlyLeadInput): Record<string, unknown> {
  return {
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
    company_name: input.companyName,
    phone: input.phone,
    website: input.website,
    personalization: input.personalizedBody,
    custom_variables: {
      crm_personalized_subject: input.personalizedSubject,
      crm_personalized_body: textToHtml(input.personalizedBody),
      crm_unsubscribe_url: input.unsubscribeUrl,
    },
  };
}

export async function createInstantlyCampaign(input: InstantlyCampaignInput, postalAddress: string): Promise<string> {
  const result = await request('/campaigns', {
    method: 'POST',
    body: JSON.stringify(campaignRequestBody(input, postalAddress)),
  });
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
    throw new InstantlyApiError('Instantly did not return a campaign identity.', 200);
  }
  return result.id;
}

export async function addInstantlyLeads(campaignId: string, leads: InstantlyLeadInput[]): Promise<void> {
  await request('/leads/add', {
    method: 'POST',
    body: JSON.stringify({ campaign_id: campaignId, leads: leads.map(leadRequestBody) }),
  });
}

export async function addInstantlyBlocklistEntry(email: string): Promise<void> {
  try {
    await request('/block-lists-entries', {
      method: 'POST',
      body: JSON.stringify({ bl_value: email.trim().toLowerCase() }),
    });
  } catch (error) {
    if (error instanceof InstantlyApiError && error.status === 409) return;
    throw error;
  }
}

export async function createInstantlyWebhook(campaignId: string, endpoint: string): Promise<string> {
  const { webhookSecret } = credentials();
  const result = await request('/webhooks', {
    method: 'POST',
    body: JSON.stringify({
      campaign: campaignId,
      name: 'Shield Assurance CRM events',
      target_hook_url: endpoint,
      event_type: 'all_events',
      headers: { Authorization: `Bearer ${webhookSecret}` },
    }),
  });
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') {
    throw new InstantlyApiError('Instantly did not return a webhook identity.', 200);
  }
  return result.id;
}

export async function activateInstantlyCampaign(campaignId: string): Promise<void> {
  await request(`/campaigns/${encodeURIComponent(campaignId)}/activate`, { method: 'POST' });
}

export async function pauseInstantlyCampaign(campaignId: string): Promise<void> {
  await request(`/campaigns/${encodeURIComponent(campaignId)}/pause`, { method: 'POST' });
}
