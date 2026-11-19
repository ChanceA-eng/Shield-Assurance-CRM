import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { databaseError } from './workspace-api';
import { WorkspaceError } from './record-scope';
import { isRecord, isUuid } from './workspace-validation';
import { strongestDeliveryEvent } from './email-delivery-status';
import { resendConfiguration, resendConfigured } from '@crm/shared/resend';

export function emailConfigurationHash(): string {
  return createHash('sha256').update(JSON.stringify([
    process.env.RESEND_FROM_EMAIL?.trim().toLowerCase(),
    process.env.RESEND_REPLY_TO?.trim().toLowerCase(),
    process.env.RESEND_INBOUND_ADDRESS?.trim().toLowerCase(),
    process.env.RESEND_WEBHOOK_SECRET,
  ])).digest('hex');
}

export async function verifiedReplyCheck(db: SupabaseClient): Promise<string | null> {
  const result = await db.from('email_setup_checks').select('verified_at')
    .eq('configuration_hash', emailConfigurationHash()).not('verified_at', 'is', null)
    .order('verified_at', { ascending: false }).limit(1).maybeSingle<{ verified_at: string }>();
  if (result.error) throw databaseError(result.error);
  return result.data?.verified_at ?? null;
}

export async function completeReplyCheck(db: SupabaseClient, input: {
  subject: string; from: string; providerId: string;
}): Promise<boolean> {
  const id = input.subject.match(/\[CRM reply check ([0-9a-f-]{36})\]/i)?.[1];
  if (!isUuid(id)) return false;
  const found = await db.from('email_setup_checks').select('id,expected_sender,configuration_hash,expires_at,verified_at')
    .eq('id', id.toLowerCase()).maybeSingle<{
      id: string; expected_sender: string; configuration_hash: string; expires_at: string; verified_at: string | null;
    }>();
  if (found.error) throw databaseError(found.error);
  if (!found.data) return false;
  // Forwarded copies of our outbound test are not proof that replies reach the CRM.
  if (found.data.expected_sender !== input.from.toLowerCase()
    || found.data.configuration_hash !== emailConfigurationHash()
    || Date.parse(found.data.expires_at) <= Date.now() || found.data.verified_at) return true;
  const saved = await db.from('email_setup_checks').update({
    verified_at: new Date().toISOString(), inbound_provider_id: input.providerId,
  }).eq('id', found.data.id).is('verified_at', null);
  if (saved.error) throw databaseError(saved.error);
  return true;
}

export interface EmailConnectionStatus {
  sender: string;
  replyTo: string;
  sendingEnabled: boolean;
  domain: string;
  domainStatus: string;
  replyVerifiedAt: string | null;
  replyReady: boolean;
  inboundAddress: string;
  issues: string[];
  latestTest: { id: string; createdAt: string; delivery: string; replyVerified: boolean } | null;
  openTracking?: boolean;
  trackingStatus?: string;
  trackingRecord?: { name: string; value: string } | null;
}

export async function emailConnectionStatus(db: SupabaseClient, actorId: string): Promise<EmailConnectionStatus> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL?.trim() ?? '';
  const domain = from.split('@')[1] ?? '';
  let domainStatus = 'Not configured';
  let openTracking = false;
  let trackingStatus = 'Not configured';
  let trackingRecord: { name: string; value: string } | null = null;
  if (key && domain) {
    const response = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    if (!response.ok) {
      console.error('[email/status] Resend domain lookup failed', response.status);
      throw new WorkspaceError('Could not check Resend. Check the API key permissions and connection in deployment configuration, then retry.', 502);
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.data)) throw new WorkspaceError('Resend returned an invalid domain status. Retry the check.', 502);
    const entry: unknown = payload.data.find((item: unknown) => isRecord(item) && item.name === domain);
    domainStatus = isRecord(entry) && typeof entry.status === 'string' ? entry.status : 'Domain not found';
    if (isRecord(entry) && typeof entry.id === 'string') {
      const detail = await fetch(`https://api.resend.com/domains/${entry.id}`, {
        headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000), cache: 'no-store',
      });
      if (!detail.ok) throw new WorkspaceError('Could not check email tracking. Refresh status to retry.', 502);
      const domainInfo: unknown = await detail.json();
      if (!isRecord(domainInfo)) throw new WorkspaceError('Resend returned an invalid tracking status. Refresh status to retry.', 502);
      openTracking = domainInfo.open_tracking === true;
      const record: unknown = Array.isArray(domainInfo.records)
        ? domainInfo.records.find((row: unknown) => isRecord(row) && row.record === 'Tracking') : undefined;
      trackingStatus = isRecord(record) && typeof record.status === 'string' ? record.status : 'Not configured';
      if (isRecord(record) && typeof record.name === 'string' && typeof record.value === 'string') {
        trackingRecord = { name: record.name, value: record.value };
      }
    }
  }
  const replyVerifiedAt = await verifiedReplyCheck(db);
  const issues: string[] = [];
  for (const name of ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_REPLY_TO', 'RESEND_WEBHOOK_SECRET', 'RESEND_INBOUND_ADDRESS', 'EMAIL_POSTAL_ADDRESS', 'CRM_WEB_ORIGIN'] as const) {
    if (!process.env[name]?.trim()) issues.push(`Requires deployment configuration: add ${name}.`);
  }
  if (!process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.EMAIL_UNSUBSCRIBE_SECRET.length < 32) issues.push('Requires deployment configuration: set EMAIL_UNSUBSCRIBE_SECRET to at least 32 characters.');
  if (process.env.CRM_WEB_ORIGIN) {
    try { if (new URL(process.env.CRM_WEB_ORIGIN).protocol !== 'https:') issues.push('Requires deployment configuration: use HTTPS for CRM_WEB_ORIGIN.'); }
    catch { issues.push('Requires deployment configuration: correct CRM_WEB_ORIGIN.'); }
  }
  if (process.env.RESEND_SENDING_ENABLED !== 'true') issues.push('Requires deployment configuration: set RESEND_SENDING_ENABLED=true.');
  if (domainStatus !== 'verified') issues.push(`Sending domain: ${domainStatus}. Complete domain verification outside the CRM, then refresh.`);
  const latest = await db.from('email_setup_checks').select('id,created_at,verified_at')
    .eq('actor_id', actorId).eq('configuration_hash', emailConfigurationHash())
    .order('created_at', { ascending: false }).limit(1).maybeSingle<{ id: string; created_at: string; verified_at: string | null }>();
  if (latest.error) throw databaseError(latest.error);
  let delivery = 'Not sent';
  if (latest.data) {
    const attempt = await db.from('resend_send_attempts').select('id,status')
      .eq('request_key', `email-setup:${latest.data.id}`).maybeSingle<{ id: string; status: string }>();
    if (attempt.error) throw databaseError(attempt.error);
    if (attempt.data) {
      delivery = attempt.data.status === 'accepted' ? 'Accepted by provider' : 'Unconfirmed - do not resend';
      const event = await db.from('resend_delivery_events').select('type,occurred_at')
        .eq('attempt_id', attempt.data.id);
      if (event.error) throw databaseError(event.error);
      const strongest = strongestDeliveryEvent(event.data ?? []);
      if (strongest) delivery = strongest.type.replace(/^email\./, '').replace(/_/g, ' ');
    }
  }
  return {
    sender: from, replyTo: process.env.RESEND_REPLY_TO ?? '', domain, domainStatus,
    sendingEnabled: resendConfigured(resendConfiguration(process.env)),
    replyVerifiedAt, replyReady: Boolean(replyVerifiedAt) || process.env.RESEND_REPLY_SYNC_READY === 'true',
    inboundAddress: process.env.RESEND_INBOUND_ADDRESS ?? '', issues,
    openTracking, trackingStatus, trackingRecord,
    latestTest: latest.data ? { id: latest.data.id, createdAt: latest.data.created_at, delivery, replyVerified: Boolean(latest.data.verified_at) } : null,
  };
}
