import type { SupabaseClient } from '@supabase/supabase-js';
import type { MarketingProfile, OutreachSender, RecordTarget, WorkspaceAsset, WorkspaceNote } from '@crm/shared';
import { recordFilter, resolveRecordScope } from './record-scope';
import { databaseError } from './workspace-api';
import { getMarketingProfile, getOutreachSender } from './marketing-profile';

export interface OutreachConversation {
  direction: string;
  subject: string | null;
  body: string | null;
  sent_at: string;
}

export async function recordOutreachContext(supabase: SupabaseClient, target: RecordTarget): Promise<{
  workspace_assets: WorkspaceAsset[];
  workspace_notes: WorkspaceNote[];
  marketing_profile: MarketingProfile;
  outreach_sender: OutreachSender;
  recent_conversation: OutreachConversation[];
}> {
  const scope = await resolveRecordScope(supabase, target);
  const assets: WorkspaceAsset[] = [];
  for (let offset = 0; ; offset += 100) {
    const result = await supabase.from('client_assets').select('*').or(recordFilter(scope))
      .is('archived_at', null).in('asset_type', ['vehicle', 'property', 'equipment', 'driver', 'general'])
      .order('id').range(offset, offset + 99).returns<WorkspaceAsset[]>();
    if (result.error) throw databaseError(result.error);
    assets.push(...(result.data ?? []));
    if ((result.data ?? []).length < 100) break;
  }
  const notes = await supabase.from('interactions').select('*').or(recordFilter(scope)).is('archived_at', null)
    .order('pinned', { ascending: false }).order('updated_at', { ascending: false }).limit(20).returns<WorkspaceNote[]>();
  if (notes.error) throw databaseError(notes.error);
  const [marketingProfile, sender, conversation] = await Promise.all([
    getMarketingProfile(supabase, target),
    getOutreachSender(supabase),
    supabase.from('canonical_communications').select('direction,subject,body,sent_at')
      .eq('conversation_key', scope.clientId ? `client:${scope.clientId}` : `lead:${scope.leadId}`)
      .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(12).returns<OutreachConversation[]>(),
  ]);
  if (conversation.error) throw databaseError(conversation.error);
  return {
    workspace_assets: assets, workspace_notes: notes.data ?? [],
    marketing_profile: marketingProfile, outreach_sender: sender, recent_conversation: conversation.data ?? [],
  };
}

export function leadOutreachContext(supabase: SupabaseClient, leadId: string): ReturnType<typeof recordOutreachContext> {
  return recordOutreachContext(supabase, { type: 'lead', id: leadId });
}
