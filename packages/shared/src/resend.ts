import { createHash, randomUUID } from 'node:crypto';
import { Resend } from 'resend';
import { renderEmailHtml, emailPlainText } from './email-presentation.js';
import { parseEmailDocument, parseEmailRows } from './email-document.js';
import type { EmailFormatting } from './email-presentation.js';
import { parseEmailDesign, type EmailDesign } from './email-design.js';

export interface ResendMessage extends EmailFormatting {
  to: string;
  subject: string;
  body: string;
  emailDesign?: EmailDesign;
  attachments?: Array<{ filename: string; content: string; type?: string }>;
  headers?: Record<string, string>;
  purpose?: 'service' | 'marketing';
  requestId?: string;
  leadId?: string;
  clientId?: string;
}

export interface ResendConfiguration {
  apiKey?: string;
  from?: string;
  replyTo?: string;
  enabled?: string;
  databaseUrl?: string;
  databaseKey?: string;
}

export class ResendSendError extends Error {
  constructor(message: string, public readonly code: 'send_blocked' | 'send_check_failed' | 'acceptance_unrecorded', public readonly status: number) {
    super(message);
    this.name = 'ResendSendError';
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function resendConfigured(config: ResendConfiguration): boolean {
  return Boolean(config.apiKey?.trim() && config.from?.trim() && config.replyTo?.trim()
    && config.databaseUrl?.trim() && config.databaseKey?.trim() && config.enabled === 'true');
}

export function resendConfiguration(env: Record<string, string | undefined>): ResendConfiguration {
  return {
    apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL, replyTo: env.RESEND_REPLY_TO,
    enabled: env.RESEND_SENDING_ENABLED,
    databaseUrl: env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL,
    databaseKey: env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function rpc(config: ResendConfiguration, name: string, body: Record<string, unknown>): Promise<unknown> {
  const unavailable = (): ResendSendError => name === 'finish_resend_send'
    ? new ResendSendError('Email was accepted by Resend, but its receipt could not be recorded. Check delivery history; do not resend.', 'acceptance_unrecorded', 503)
    : new ResendSendError('Email safety checks could not complete. Nothing was sent. Check the database connection and email schema before trying again.', 'send_check_failed', 503);
  let response: Response;
  try {
    response = await fetch(`${config.databaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: config.databaseKey ?? '', Authorization: `Bearer ${config.databaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
  } catch {
    console.error(`[resend/${name}] database connection failed`);
    throw unavailable();
  }
  if (!response.ok) {
    let failure: unknown;
    try { failure = await response.json(); }
    catch {
      console.error(`[resend/${name}] invalid database error response`, response.status);
      throw unavailable();
    }
    const code = record(failure) && typeof failure.code === 'string' ? failure.code : '';
    const message = record(failure) && typeof failure.message === 'string' ? failure.message : '';
    console.error(`[resend/${name}] database request failed`, response.status, code);
    if (name === 'finish_resend_send') {
      throw unavailable();
    }
    const refusals = new Set([
      'This address is blocked from email. Nothing was sent.',
      'Restore the lead and confirm its email before sending.',
      'Recorded marketing permission is required.',
      'This send request was already used for different content.',
    ]);
    if (code === '42501' && message === 'This imported contact has not requested email or given recorded permission.') {
      throw new ResendSendError('This imported/discovered lead has no recorded email permission or prior request. Resend cannot send this first-contact email. Record genuine permission in Settings > Marketing permission; do not record consent just to bypass this check.', 'send_blocked', 403);
    }
    if ((code === '42501' || code === 'PT409') && refusals.has(message)) {
      throw new ResendSendError(message, 'send_blocked', code === 'PT409' ? 409 : 403);
    }
    throw unavailable();
  }
  try {
    const text = await response.text();
    if (!text && name === 'finish_resend_send') return null;
    return JSON.parse(text) as unknown;
  } catch {
    console.error(`[resend/${name}] invalid database response`);
    throw unavailable();
  }
}

export async function sendResendEmail(message: ResendMessage, config: ResendConfiguration): Promise<{ providerId: string }> {
  const design = parseEmailDesign(message.emailDesign);
  const formatting = { bodyDocument: parseEmailDocument(message.bodyDocument), signatureDocument: parseEmailDocument(message.signatureDocument),
    signatureRows: parseEmailRows(message.signatureRows) };
  const html = renderEmailHtml(message.body, design, formatting);
  if (!resendConfigured(config)) throw new Error('Resend is not ready. Complete and verify email setup in Settings before enabling sending.');
  for (const address of [message.to, config.from, config.replyTo]) {
    if (!address || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(address)) throw new Error('Enter a valid sender, recipient and reply-to email address.');
  }
  if (/[\r\n]/.test(message.subject)) throw new Error('Email subjects cannot contain line breaks.');
  const purpose = message.purpose ?? 'service';
  if (purpose === 'marketing' && (!message.headers?.['List-Unsubscribe'] || !message.headers['List-Unsubscribe-Post'])) {
    throw new Error('Marketing email requires an unsubscribe link and one-click unsubscribe headers.');
  }
  const hash = createHash('sha256').update(JSON.stringify({
    to: message.to.toLowerCase(), from: config.from, replyTo: config.replyTo,
    subject: message.subject, body: message.body, attachments: message.attachments ?? [], headers: message.headers ?? {}, purpose,
    ...(design ? { emailDesign: design } : {}),
    ...(formatting.bodyDocument ? { bodyDocument: formatting.bodyDocument } : {}),
    ...(formatting.signatureDocument ? { signatureDocument: formatting.signatureDocument } : {}),
    ...(formatting.signatureRows ? { signatureRows: formatting.signatureRows } : {}),
  })).digest('hex');
  const attempt = await rpc(config, 'begin_resend_send', {
    p_request_key: message.requestId ?? randomUUID(), p_to: message.to.toLowerCase(),
    p_subject: message.subject, p_hash: hash, p_purpose: purpose,
    p_lead_id: message.leadId ?? null, p_client_id: message.clientId ?? null,
  });
  if (!record(attempt) || typeof attempt.id !== 'string') throw new Error('The email send could not be recorded. Nothing was sent.');
  if (attempt.status === 'accepted' && typeof attempt.provider_id === 'string') return { providerId: attempt.provider_id };
  if (attempt.claimed !== true) throw new Error('This send is blocked, in progress or uncertain. Check delivery history before trying again.');

  // A durable claim precedes the provider call. Ambiguous attempts are never retried automatically.
  const { data, error } = await new Resend(config.apiKey).emails.send({
    from: `Shield Assurance <${config.from}>`, replyTo: config.replyTo, to: [message.to.toLowerCase()],
    subject: message.subject, text: emailPlainText(message.body, design, formatting),
    html,
    headers: message.headers,
    attachments: message.attachments?.map((file) => ({ filename: file.filename, content: file.content, contentType: file.type })),
    tags: [{ name: 'crm_attempt', value: attempt.id }],
  }, { idempotencyKey: attempt.id, signal: AbortSignal.timeout(15000) });
  if (error) {
    console.error('[resend] Send request rejected', error.name);
    throw new Error('Resend did not confirm acceptance. Check email delivery history before resending.');
  }
  if (!data?.id) throw new Error('Resend acceptance is uncertain. Check delivery history; do not resend.');
  console.info('[resend] Email accepted', data.id);
  await rpc(config, 'finish_resend_send', { p_id: attempt.id, p_provider_id: data.id });
  return { providerId: data.id };
}
