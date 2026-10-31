import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';
import { scheduleIntakeTask } from '../../../../../lib/intake-task';
import { buildProspects, detectVendorProfile, type ImportRow, type VendorProfile } from '../../../../../lib/lead-import';

interface RouteContext {
  params: Promise<{ batchId: string }>;
}

interface StagedRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  disposition: string;
  payload: {
    profile?: Record<string, unknown>;
    raw?: Record<string, unknown>[];
  } | null;
}

interface RenewalSignal {
  type?: string;
  date?: string;
  carrier?: string | null;
  broker?: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Task due ~60 days before the renewal date; tomorrow if that window already passed. */
function renewalTaskDue(renewalDate: string): string | null {
  const renewal = new Date(`${renewalDate}T09:00:00`);
  if (Number.isNaN(renewal.getTime()) || renewal.getTime() < Date.now()) return null;
  const due = new Date(renewal.getTime() - 60 * 86400 * 1000);
  if (due.getTime() < Date.now()) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    return tomorrow.toISOString();
  }
  return due.toISOString();
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { batchId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as { include_ids?: string[] };
  const includeIds = Array.isArray(body.include_ids) ? new Set(body.include_ids) : null;

  const batchRes = await supabase.from('import_batches').select('*').eq('id', batchId).maybeSingle();
  if (batchRes.error) return NextResponse.json({ message: batchRes.error.message }, { status: 500 });
  if (!batchRes.data) return NextResponse.json({ message: 'Batch not found.' }, { status: 404 });

  const stagedRes = await supabase
    .from('import_prospects')
    .select('id,full_name,email,phone,address,line_of_business,disposition,payload')
    .eq('batch_id', batchId)
    .limit(2000);

  if (stagedRes.error) return NextResponse.json({ message: stagedRes.error.message }, { status: 500 });

  const staged = (stagedRes.data ?? []) as StagedRow[];
  const toCommit = staged.filter((row) => {
    if (row.disposition === 'committed') return false;
    if (includeIds) return includeIds.has(row.id);
    return row.disposition === 'pending';
  });

  if (toCommit.length === 0) {
    return NextResponse.json({ message: 'Nothing selected to commit.' }, { status: 400 });
  }

  // Contact gate: a lead you cannot reach is not a lead.
  const blocked = toCommit.filter((row) => !row.email?.trim() && !row.phone?.trim());
  const committable = toCommit.filter((row) => row.email?.trim() || row.phone?.trim());

  let committed = 0;
  let tasksCreated = 0;
  const errors: string[] = [];

  for (const row of committable) {
    // Always re-extract from raw rows with the current parser at commit time —
    // a batch staged under an older parser can never freeze stale extraction.
    let profile = row.payload?.profile ?? {};
    const rawRows = row.payload?.raw;
    if (Array.isArray(rawRows) && rawRows.length > 0) {
      try {
        const vendorProfile = (batchRes.data.vendor_profile || detectVendorProfile(rawRows as ImportRow[])) as VendorProfile;
        const rebuilt = buildProspects(rawRows as ImportRow[], vendorProfile)[0];
        if (rebuilt) profile = rebuilt.profile;
      } catch {
        // Fall back to the staged profile.
      }
    }
    const kind = text(profile.kind) ?? 'generic';
    const company = (profile.company ?? {}) as Record<string, unknown>;

    const leadInsert = await supabase
      .from('leads')
      .insert([
        {
          full_name: row.full_name,
          email: row.email,
          phone: row.phone,
          address: row.address,
          line_of_business: row.line_of_business ?? 'General',
          source: 'prospect_import',
          status: 'new',
          business: kind === 'commercial' ? row.full_name : null,
          industry: text(company.industry),
          website: text(company.website),
          est_employees: text(company.employees),
          est_revenue: text(company.sales_range),
          details: `Imported from ${batchRes.data.file_name}`,
          form_payload: {
            profile,
            import: { batch_id: batchId, file_name: batchRes.data.file_name },
          },
        },
      ])
      .select('id,full_name')
      .single<{ id: string; full_name: string }>();

    if (leadInsert.error || !leadInsert.data) {
      errors.push(`${row.full_name}: ${leadInsert.error?.message ?? 'insert failed'}`);
      continue;
    }

    committed += 1;

    await supabase
      .from('import_prospects')
      .update({ disposition: 'committed', lead_id: leadInsert.data.id })
      .eq('id', row.id);

    // X-date tasks: the renewal calendar is the whole point of commercial data.
    const renewals = Array.isArray(profile.renewals) ? (profile.renewals as RenewalSignal[]) : [];
    const taskRows = renewals
      .map((renewal) => {
        if (!renewal.date || !renewal.type) return null;
        const due = renewalTaskDue(renewal.date);
        if (!due) return null;
        const incumbent = renewal.carrier ? ` — currently with ${renewal.carrier}` : '';
        return {
          subject: `${row.full_name} — ${renewal.type} renewal approaching`,
          description: `Their ${renewal.type} policy renews ${renewal.date}${incumbent}${renewal.broker ? ` (broker: ${renewal.broker})` : ''}. Reach out early enough to get on their quote list before the renewal window closes.`,
          due_date: due,
          status: 'open',
          priority: 'medium',
          related_type: 'lead',
          related_id: leadInsert.data.id,
        };
      })
      .filter((task): task is NonNullable<typeof task> => task !== null);

    if (taskRows.length > 0) {
      const taskInsert = await supabase.from('tasks').insert(taskRows);
      if (!taskInsert.error) tasksCreated += taskRows.length;
    }

    // Every committed lead gets a contact task (next business day, 4 PM AZ).
    await scheduleIntakeTask(supabase, { leadId: leadInsert.data.id, name: row.full_name, warm: false });
  }

  // Unselected prospects stay pending — they remain available for a later commit.
  const pendingLeft = await supabase
    .from('import_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('disposition', 'pending');

  const committedTotal = await supabase
    .from('import_prospects')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batchId)
    .eq('disposition', 'committed');

  await supabase
    .from('import_batches')
    .update({
      status: (pendingLeft.count ?? 0) > 0 ? 'review' : 'committed',
      committed_count: committedTotal.count ?? committed,
    })
    .eq('id', batchId);

  return NextResponse.json(
    {
      committed,
      tasks_created: tasksCreated,
      failed: errors.length,
      blocked_no_contact: blocked.length,
      errors: errors.slice(0, 10),
    },
    { status: 200 },
  );
}
