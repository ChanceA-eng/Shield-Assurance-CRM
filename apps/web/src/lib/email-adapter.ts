/**
 * Outbound email adapter. Prefers the agency's own Gmail (Google Workspace) so
 * sent mail lives in the real mailbox and replies land in the normal inbox.
 * Falls back to SendGrid when Gmail is not configured.
 *
 * Gmail setup (one-time, free):
 * 1. console.cloud.google.com -> create project -> enable "Gmail API".
 * 2. OAuth consent screen (Internal if Workspace) -> create OAuth Client ID (Desktop app).
 * 3. Obtain a refresh token for the sending mailbox with scope
 *    https://www.googleapis.com/auth/gmail.send (e.g. via OAuth playground with your own client).
 * 4. Set env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_SENDER.
 */

import { sendEmail } from './messaging';

export interface OutboundEmail {
  to: string;
  subject: string;
  body: string;
  attachments?: Array<{ filename: string; content: string; type?: string }>;
}

export type EmailProvider = 'gmail' | 'sendgrid';

export function gmailConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID?.trim() &&
      process.env.GOOGLE_CLIENT_SECRET?.trim() &&
      process.env.GMAIL_REFRESH_TOKEN?.trim() &&
      process.env.GMAIL_SENDER?.trim(),
  );
}

async function gmailAccessToken(): Promise<string> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID ?? '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      refresh_token: process.env.GMAIL_REFRESH_TOKEN ?? '',
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Gmail token refresh failed (${response.status}): ${await response.text().catch(() => '')}`);
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error('Gmail token refresh returned no access token.');
  return payload.access_token;
}

function base64Url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds an RFC 2822 message, multipart when attachments are present. */
function buildMime(payload: OutboundEmail): string {
  const sender = process.env.GMAIL_SENDER?.trim() ?? '';
  const headers = [
    `From: Shield Assurance <${sender}>`,
    `To: ${payload.to.trim().toLowerCase()}`,
    `Subject: ${payload.subject.trim()}`,
    'MIME-Version: 1.0',
  ];
  const attachments = (payload.attachments ?? []).filter((item) => item.filename && item.content);

  if (attachments.length === 0) {
    return [...headers, 'Content-Type: text/plain; charset="UTF-8"', '', payload.body].join('\r\n');
  }

  const boundary = `mixed_${Date.now().toString(36)}`;
  const parts: string[] = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    payload.body,
  ];
  for (const attachment of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${attachment.type || 'application/octet-stream'}; name="${attachment.filename}"`,
      'Content-Transfer-Encoding: base64',
      `Content-Disposition: attachment; filename="${attachment.filename}"`,
      '',
      attachment.content,
    );
  }
  parts.push(`--${boundary}--`);
  return parts.join('\r\n');
}

async function sendViaGmail(payload: OutboundEmail): Promise<void> {
  const token = await gmailAccessToken();
  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64Url(buildMime(payload)) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Gmail send failed (${response.status}): ${await response.text().catch(() => '')}`);
  }
}

/** Sends an email through the best configured provider and reports which one handled it. */
export async function sendOutboundEmail(payload: OutboundEmail): Promise<EmailProvider> {
  if (gmailConfigured()) {
    await sendViaGmail(payload);
    return 'gmail';
  }
  await sendEmail(payload);
  return 'sendgrid';
}
