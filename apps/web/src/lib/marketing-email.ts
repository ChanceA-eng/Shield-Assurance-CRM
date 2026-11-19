import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';

function signingKey(): string {
  const key = process.env.EMAIL_UNSUBSCRIBE_SECRET;
  if (!key || key.length < 32) throw new WorkspaceError('Marketing setup is incomplete. Ask your administrator to configure unsubscribe links.', 503);
  return key;
}

export function unsubscribeToken(email: string): string {
  const encoded = Buffer.from(email.trim().toLowerCase()).toString('base64url');
  return `${encoded}.${createHmac('sha256', signingKey()).update(encoded).digest('base64url')}`;
}

export function readUnsubscribeToken(token: string): string {
  const [encoded, supplied, extra] = token.split('.');
  if (!encoded || !supplied || extra || token.length > 1024) throw new WorkspaceError('This unsubscribe link is not valid.', 400);
  const expected = createHmac('sha256', signingKey()).update(encoded).digest();
  const actual = Buffer.from(supplied, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(expected, actual)) throw new WorkspaceError('This unsubscribe link is not valid.', 400);
  const email = Buffer.from(encoded, 'base64url').toString('utf8');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new WorkspaceError('This unsubscribe link is not valid.', 400);
  return email;
}

export async function requireMarketingConsent(db: SupabaseClient, email: string): Promise<void> {
  const consent = await db.from('marketing_email_consents').select('email')
    .eq('email', email.trim().toLowerCase()).is('revoked_at', null).maybeSingle();
  if (consent.error) throw databaseError(consent.error);
  if (!consent.data) throw new WorkspaceError("Record the recipient's marketing permission in Settings before sending promotional email.", 403);
}

export function marketingEnvelope(email: string, body: string): { body: string; headers: Record<string, string> } {
  const origin = process.env.CRM_WEB_ORIGIN;
  const address = process.env.EMAIL_POSTAL_ADDRESS?.trim();
  if (!origin || !address) throw new WorkspaceError('Marketing setup needs the CRM website address and your full business mailing address.', 503);
  const url = new URL('/api/email/unsubscribe', origin);
  if (url.protocol !== 'https:' || url.username || url.password) throw new WorkspaceError('Marketing unsubscribe links require a secure CRM website address.', 503);
  url.searchParams.set('token', unsubscribeToken(email));
  return {
    body: `${body}\n\nShield Assurance\n${address}\nUnsubscribe: ${url.href}`,
    headers: { 'List-Unsubscribe': `<${url.href}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}
