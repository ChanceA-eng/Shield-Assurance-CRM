import type { SupabaseClient } from '@supabase/supabase-js';
import type { OutreachSender } from '@crm/shared';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { getOutreachSender, parseOutreachSender } from './marketing-profile';

export interface AgencyMember {
  user_id: string;
  email: string;
  role: 'owner' | 'admin' | 'agent';
  active: boolean;
  sender_profile: OutreachSender | null;
  gmail_ai_opt_in: boolean;
}

export function agencyEnabled(): boolean { return process.env.CRM_MULTI_AGENT_ENABLED === 'true'; }

export function teamInviteRedirect(): string | null {
  const configured = process.env.CRM_INVITE_REDIRECT_URI?.trim();
  const origin = process.env.CRM_WEB_ORIGIN?.trim();
  if (!configured && !origin) return null;
  try {
    const url = configured ? new URL(configured) : new URL('/auth/accept', origin);
    if (url.pathname !== '/auth/accept' || url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function gmailSetupIssues(): string[] {
  const issues: string[] = [];
  if (!agencyEnabled()) issues.push('Set CRM_MULTI_AGENT_ENABLED=true only after verifying agent record permissions and assignments. This also switches email to each agent\'s own Gmail mailbox.');
  if (process.env.CRM_GMAIL_ENABLED !== 'true') issues.push('Set CRM_GMAIL_ENABLED=true after configuring and testing agent Gmail authorization.');
  for (const name of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GMAIL_OAUTH_REDIRECT_URI', 'GMAIL_TOKEN_KEYS', 'GMAIL_TOKEN_KEY_VERSION',
    'GMAIL_PUBSUB_TOPIC', 'GMAIL_PUBSUB_AUDIENCE', 'GMAIL_PUBSUB_SERVICE_ACCOUNT']) {
    if (!process.env[name]?.trim()) issues.push(`Configure ${name} in the deployment environment before enabling agent mailboxes.`);
  }
  return issues;
}

export async function activeAgencyMember(db: SupabaseClient, userId: string): Promise<AgencyMember> {
  const { data, error } = await db.from('agency_members').select('user_id,email,role,active,sender_profile,gmail_ai_opt_in')
    .eq('user_id', userId).maybeSingle<AgencyMember>();
  if (error) throw databaseError(error);
  if (!data?.active) throw new WorkspaceError('Active agency membership is required. Ask the owner for access.', 403);
  return data;
}

export async function agentSender(db: SupabaseClient, userId: string): Promise<OutreachSender> {
  const member = await activeAgencyMember(db, userId);
  if (!member.sender_profile) throw new WorkspaceError('Complete your agent sender profile in My Account before drafting or sending.', 409);
  const agency = await getOutreachSender(db);
  return parseOutreachSender({ ...member.sender_profile, agency: agency.agency, approved_claims: agency.approved_claims });
}
