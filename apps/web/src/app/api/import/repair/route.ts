import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { buildProspects, detectVendorProfile, parseImport, type ImportRow } from '../../../../lib/lead-import';

export const runtime = 'nodejs';

interface LegacyLead {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  form_payload: {
    row?: Record<string, unknown>;
    profile?: unknown;
    import?: { batch_id?: string };
    [key: string]: unknown;
  } | null;
}

/**
 * Repairs leads mangled by the legacy importer: re-maps the preserved raw row
 * through the vendor-aware parser to recover real names, emails, and phones.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { force?: boolean };
  const force = body.force === true;

  const { data, error } = await supabase
    .from('leads')
    .select('id,full_name,email,phone,address,form_payload')
    .eq('source', 'prospect_import')
    .limit(1000);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  let repaired = 0;
  let skipped = 0;
  const failures: string[] = [];

  for (const lead of (data ?? []) as LegacyLead[]) {
    const raw = lead.form_payload?.row;
    const stagedBatchId = lead.form_payload?.import?.batch_id;
    if ((!raw || typeof raw !== 'object') && !stagedBatchId) {
      skipped += 1;
      continue;
    }
    if (lead.form_payload?.profile && !force) {
      skipped += 1;
      continue;
    }

    try {
      let prospect;

      if (raw && typeof raw === 'object') {
        // Legacy importer lead: re-parse the preserved single row via CSV round-trip.
        const keys = Object.keys(raw);
        const escape = (value: unknown): string => {
          const str = value === null || value === undefined ? '' : String(value);
          return `"${str.replace(/"/g, '""')}"`;
        };
        const csv = `${keys.map(escape).join(',')}\n${keys.map((key) => escape(raw[key])).join(',')}`;
        prospect = parseImport(Buffer.from(csv, 'utf-8'), 'repair.csv').prospects[0];
      } else {
        // Import Center lead: rebuild from its staged raw rows with the current parser.
        const stagedRes = await supabase
          .from('import_prospects')
          .select('payload')
          .eq('lead_id', lead.id)
          .maybeSingle<{ payload: { raw?: ImportRow[] } | null }>();
        const stagedRaw = stagedRes.data?.payload?.raw;
        if (Array.isArray(stagedRaw) && stagedRaw.length > 0) {
          prospect = buildProspects(stagedRaw, detectVendorProfile(stagedRaw))[0];
        }
      }

      if (!prospect) {
        skipped += 1;
        continue;
      }

      const isFallbackName = /^Prospect \d+$/i.test(lead.full_name.trim());
      const updates: Record<string, unknown> = {
        form_payload: {
          ...(lead.form_payload ?? {}),
          profile: prospect.profile,
          repaired_at: new Date().toISOString(),
        },
      };

      if (isFallbackName && prospect.full_name && !/^Unknown|^Imported lead/.test(prospect.full_name)) {
        updates.full_name = prospect.full_name;
      }
      if (!lead.email && prospect.email) updates.email = prospect.email;
      if (!lead.phone && prospect.phone) updates.phone = prospect.phone;
      if (!lead.address && prospect.address) updates.address = prospect.address;
      if (prospect.line_of_business && prospect.line_of_business !== 'General') {
        updates.line_of_business = prospect.line_of_business;
      }

      // Backfill column-level enrichment the legacy importer missed.
      const company = (prospect.profile.company ?? {}) as Record<string, unknown>;
      const textOf = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
      if (textOf(company.industry)) updates.industry = textOf(company.industry);
      if (textOf(company.website)) updates.website = textOf(company.website);
      if (textOf(company.employees)) updates.est_employees = textOf(company.employees);
      if (textOf(company.sales_range)) updates.est_revenue = textOf(company.sales_range);

      const update = await supabase.from('leads').update(updates).eq('id', lead.id);
      if (update.error) {
        failures.push(`${lead.id}: ${update.error.message}`);
      } else {
        repaired += 1;
      }
    } catch (err) {
      failures.push(`${lead.id}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  return NextResponse.json(
    { repaired, skipped, failed: failures.length, failures: failures.slice(0, 10) },
    { status: 200 },
  );
}
