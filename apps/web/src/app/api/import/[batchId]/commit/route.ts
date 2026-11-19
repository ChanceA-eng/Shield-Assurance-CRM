import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../lib/api-auth';
import { buildProspects, detectVendorProfile } from '../../../../../lib/lead-import';
import { classifiedImportProfile, importRenewalTasks } from '../../../../../lib/import-intelligence';
import { databaseError, friendlyErrorMessage, workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { isRecord, isUuid } from '../../../../../lib/workspace-validation';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { discoveryAccess } from '../../../../../lib/discovery';
import { getAutomationSettings } from '../../../../../lib/automation-settings';

interface RouteContext { params: Promise<{ batchId: string }> }

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const { batchId } = await context.params;
    const body = await workspaceBody(request);
    if (!isUuid(batchId) || (body.include_ids !== undefined && (!Array.isArray(body.include_ids)
      || !body.include_ids.length || !body.include_ids.every((id) => isUuid(id))))) {
      throw new WorkspaceError('Choose a valid batch and selected prospects.', 400);
    }
    const includeIds = Array.isArray(body.include_ids) ? new Set(body.include_ids as string[]) : null;
    const batch = await db.from('import_batches').select('*').eq('id', batchId).maybeSingle();
    if (batch.error) throw databaseError(batch.error);
    if (!batch.data) throw new WorkspaceError('Batch not found.', 404);
    if (batch.data.discovery_source_id) await discoveryAccess(db, session.user.id);
    const settings = await getAutomationSettings(db);
    const rows: Array<Record<string, unknown>> = [];
    for (let offset = 0; ; offset += 500) {
      const result = await db.from('import_prospects').select('*').eq('batch_id', batchId).order('id').range(offset, offset + 499);
      if (result.error) throw databaseError(result.error);
      rows.push(...(result.data ?? []));
      if ((result.data ?? []).length < 500) break;
    }
    if (includeIds && [...includeIds].some((id) => !rows.some((row) => row.id === id))) {
      throw new WorkspaceError('A selected prospect no longer belongs to this batch. Refresh before importing.', 409);
    }
    const selected = rows.filter((row) => includeIds ? includeIds.has(String(row.id)) : row.disposition === 'pending');
    if (!selected.length) throw new WorkspaceError('Nothing selected to commit.', 400);
    let committed = 0, tasksCreated = 0, contactTasksCreated = 0, duplicates = 0, alreadyCommitted = 0, blocked = 0;
    const errors: string[] = [];
    const results: Array<Record<string, unknown>> = [];
    for (const row of selected) {
      try {
        const payload = isRecord(row.payload) ? row.payload : {};
        if (batch.data.discovery_source_id && row.disposition !== 'committed' && !isRecord(payload.profile)) {
          throw new WorkspaceError('The acquired profile needs review before promotion.', 422);
        }
        let profile = isRecord(payload.profile) ? payload.profile : {};
        if (!batch.data.discovery_source_id && row.disposition !== 'committed' && Array.isArray(payload.raw) && payload.raw.length) {
          if (!payload.raw.every(isRecord)) throw new WorkspaceError('The source rows need review before import.', 422);
          const vendor = batch.data.vendor_profile;
          const rebuilt = buildProspects(payload.raw, vendor === 'commercial' || vendor === 'personal_auto' || vendor === 'generic' ? vendor : detectVendorProfile(payload.raw));
          if (rebuilt.length !== 1) throw new WorkspaceError('Source rows resolve to multiple prospects. Reparse and review before importing.', 422);
          profile = rebuilt[0].profile;
        }
        profile = classifiedImportProfile(profile);
        const saved = await db.rpc('promote_import_prospect', {
          p_prospect: row.id, p_batch: batchId, p_actor: session.user.id,
          p_expected: { full_name: row.full_name, email: row.email, phone: row.phone, address: row.address,
            line_of_business: row.line_of_business, payload: row.payload },
          p_profile: profile, p_tasks: importRenewalTasks(String(row.full_name), profile, new Date(), {
            enabled: settings.configuration.automation.import_renewal.tasks_enabled,
            daysBefore: settings.configuration.automation.import_renewal.task_days_before,
          }),
        });
        if (saved.error) throw databaseError(saved.error);
        const data: unknown = saved.data;
        if (!isRecord(data) || !['committed', 'already_committed', 'duplicate', 'blocked_no_contact'].includes(String(data.disposition))
          || typeof data.tasks_created !== 'number' || !Number.isInteger(data.tasks_created) || data.tasks_created < 0
          || typeof data.contact_tasks_created !== 'number' || !Number.isInteger(data.contact_tasks_created) || data.contact_tasks_created < 0
          || (['committed', 'already_committed'].includes(String(data.disposition)) && !isUuid(data.lead_id))) {
          throw new WorkspaceError('Import status could not be verified. Refresh before retrying.', 503);
        }
        if (data.disposition === 'committed') { committed++; tasksCreated += data.tasks_created; contactTasksCreated += data.contact_tasks_created; }
        if (data.disposition === 'already_committed') alreadyCommitted++;
        if (data.disposition === 'duplicate') duplicates++;
        if (data.disposition === 'blocked_no_contact') blocked++;
        results.push({ prospect_id: row.id, ...data });
      } catch (failure) {
        const message = failure instanceof WorkspaceError ? failure.message : friendlyErrorMessage(failure instanceof Error ? failure : { message: 'Import failed.' });
        console.error('[import/commit]', row.id, failure instanceof Error ? failure.message : failure);
        errors.push(`${row.full_name}: ${message}`);
        results.push({ prospect_id: row.id, disposition: 'failed', message });
      }
    }
    const warnings: string[] = [];
    if (committed && !batch.data.discovery_source_id) {
      const notification = await db.from('notifications').insert({
        type: 'new_lead', message: `${committed} imported leads added. ${contactTasksCreated} first-contact tasks and ${tasksCreated} renewal-verification tasks created. Sequences require separate enrollment and marketing permission.`,
        href: '/tasks', read: false,
      });
      if (notification.error) {
        console.error('[import/summary]', notification.error);
        warnings.push('Leads and tasks were saved, but the import summary notification could not be saved.');
      }
    }
    return NextResponse.json({ committed, tasks_created: tasksCreated, contact_tasks_created: contactTasksCreated,
      duplicates, already_committed: alreadyCommitted, blocked_no_contact: blocked, failed: errors.length,
      errors: errors.slice(0, 10), warnings, results }, { status: 200 });
  } catch (failure) {
    return workspaceApiError(failure, 'import/commit');
  }
}
