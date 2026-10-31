import type { SupabaseClient } from '@supabase/supabase-js';
import type { RecordTarget, WorkspaceAsset, WorkspaceNote } from '@crm/shared';
import { recordFilter, resolveRecordScope } from './record-scope';
import { databaseError } from './workspace-api';

export async function recordOutreachContext(supabase: SupabaseClient, target: RecordTarget): Promise<{
  workspace_assets: WorkspaceAsset[];
  workspace_notes: WorkspaceNote[];
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
  return { workspace_assets: assets, workspace_notes: notes.data ?? [] };
}

export function leadOutreachContext(supabase: SupabaseClient, leadId: string): ReturnType<typeof recordOutreachContext> {
  return recordOutreachContext(supabase, { type: 'lead', id: leadId });
}
