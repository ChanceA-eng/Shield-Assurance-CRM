import type { SupabaseClient } from '@supabase/supabase-js';
import type { BusinessResearchProfile, MarketingProfile, OutreachSender, RecordTarget, WorkspaceAsset, WorkspaceNote } from '@crm/shared';
import { recordFilter, resolveRecordScope } from './record-scope';
import { databaseError } from './workspace-api';
import { getMarketingProfile, getOutreachSender } from './marketing-profile';
import { agencyEnabled, agentSender } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';
import { prospectingEvidence } from './prospecting-evidence';

export interface OutreachConversation {
  id?: string;
  direction: string;
  subject: string | null;
  body: string | null;
  sent_at: string;
  metadata?: Record<string, unknown> | null;
}

export async function eligibleAiMessages(supabase: SupabaseClient, messages: OutreachConversation[]): Promise<OutreachConversation[]> {
  const allowed: OutreachConversation[] = [];
  for (const message of messages) {
    const metadata = isRecord(message.metadata) ? message.metadata : {};
    if (metadata.gmail_origin === true) {
      if (process.env.CRM_GMAIL_AI_ENABLED !== 'true' || typeof metadata.agent_user_id !== 'string') continue;
      const users = new Set([metadata.agent_user_id]);
      if (message.id) {
        const links = await supabase.from('gmail_message_links').select('connection_id').eq('communication_id', message.id);
        if (links.error) throw databaseError(links.error);
        const ids = [...new Set((links.data ?? []).map((link) => link.connection_id))];
        if (ids.length) {
          const sources = await supabase.from('gmail_connections').select('user_id').in('id', ids);
          if (sources.error) throw databaseError(sources.error);
          for (const source of sources.data ?? []) users.add(source.user_id);
        }
      }
      const members = await supabase.from('agency_members').select('user_id,active,gmail_ai_opt_in').in('user_id', Array.from(users));
      if (members.error) throw databaseError(members.error);
      if (members.data?.length !== users.size || members.data.some((member) => !member.active || !member.gmail_ai_opt_in)) continue;
    }
    allowed.push(message);
  }
  return allowed;
}

export async function recordOutreachContext(supabase: SupabaseClient, target: RecordTarget, actorId?: string): Promise<{
  workspace_assets: WorkspaceAsset[];
  workspace_notes: WorkspaceNote[];
  marketing_profile: MarketingProfile;
  outreach_sender: OutreachSender;
  recent_conversation: OutreachConversation[];
  prospecting_signals?: string[];
}> {
  if (agencyEnabled() && !actorId) throw new WorkspaceError('An explicit agent identity is required for AI drafting.', 400);
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
  const [marketingProfile, sender, conversation, research] = await Promise.all([
    getMarketingProfile(supabase, target),
    agencyEnabled() && actorId ? agentSender(supabase, actorId) : getOutreachSender(supabase),
    supabase.from('canonical_communications').select('id,direction,subject,body,sent_at,metadata')
      .eq('conversation_key', scope.clientId ? `client:${scope.clientId}` : `lead:${scope.leadId}`)
      .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(12).returns<OutreachConversation[]>(),
    actorId
      ? supabase.rpc('get_record_business_research', { p_actor: actorId, p_type: target.type, p_id: target.id }).single<BusinessResearchProfile>()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (conversation.error) throw databaseError(conversation.error);
  if (research.error) throw databaseError(research.error);
  const allowed = await eligibleAiMessages(supabase, conversation.data ?? []);
  return {
    workspace_assets: assets, workspace_notes: notes.data ?? [],
    marketing_profile: marketingProfile, outreach_sender: sender, recent_conversation: allowed,
    prospecting_signals: prospectingEvidence(research.data).map((signal) =>
      `${signal.source} business detail (record ${signal.recordId}; ${signal.observedOn}; retrieved ${signal.fetchedAt.slice(0, 10)}): ${signal.text}`),
  };
}

export function leadOutreachContext(supabase: SupabaseClient, leadId: string, actorId?: string): ReturnType<typeof recordOutreachContext> {
  return recordOutreachContext(supabase, { type: 'lead', id: leadId }, actorId);
}
