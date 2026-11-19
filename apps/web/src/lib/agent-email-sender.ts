import type { SupabaseClient } from '@supabase/supabase-js';
import { agencyEnabled, agentSender } from './agency-membership';
import { getOutreachSender } from './marketing-profile';
import { WorkspaceError } from './record-scope';
import { signatureFormatting } from './email-formatting';

export async function getAgentEmailSender(db: SupabaseClient, userId: string) {
  const sender = agencyEnabled() ? await agentSender(db, userId) : await getOutreachSender(db);
  const result = await db.auth.admin.getUserById(userId);
  if (result.error || !result.data.user) {
    console.error('[gmail/sender-profile]', result.error?.code ?? 'user_not_found');
    throw new WorkspaceError('Your email signature could not be loaded. Retry before sending.', 503);
  }
  const signature: unknown = result.data.user.user_metadata.signature;
  const personal = typeof signature === 'string' && signature.trim()
    ? { ...sender, signature: signature.trim() }
    : sender;
  return { ...personal, ...await signatureFormatting(db, userId) };
}
