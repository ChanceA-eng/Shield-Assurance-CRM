import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

interface MergePayload {
  survivor_id?: string;
  merge_ids?: string[];
  /** User-verified final values — applied verbatim. */
  fields?: {
    full_name?: string;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    line_of_business?: string | null;
    estimated_premium?: number | string | null;
  };
}

interface LeadRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  estimated_premium: number | string | null;
  form_payload: Record<string, unknown> | null;
  [key: string]: unknown;
}

/** Enrichment columns pulled from duplicates when the survivor lacks them — nothing is lost. */
const COALESCE_COLUMNS = [
  'industry',
  'category',
  'business',
  'website',
  'est_employees',
  'est_revenue',
  'risk_exposure',
  'details',
  'zip',
  'state',
  'primary_coverage',
  'vehicle_details',
] as const;

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function premiumOf(value: number | string | null): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Union of profile sections across merged leads; survivor's values win conflicts. */
function mergeProfiles(survivor: Record<string, unknown>, others: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...survivor };

  const contactKey = (contact: unknown): string => {
    const c = (contact ?? {}) as Record<string, unknown>;
    return `${String(c.name ?? '').toLowerCase()}|${String(c.email ?? '').toLowerCase()}`;
  };
  const renewalKey = (renewal: unknown): string => {
    const r = (renewal ?? {}) as Record<string, unknown>;
    return `${String(r.type ?? '')}|${String(r.date ?? '')}`;
  };

  const contacts = [...asArray(merged.contacts)];
  const contactKeys = new Set(contacts.map(contactKey));
  const renewals = [...asArray(merged.renewals)];
  const renewalKeys = new Set(renewals.map(renewalKey));
  const awards = new Set(asArray(merged.contract_awards).map(String));
  const extras = { ...((merged.extras ?? {}) as Record<string, unknown>) };

  for (const other of others) {
    for (const contact of asArray(other.contacts)) {
      const key = contactKey(contact);
      if (!contactKeys.has(key)) {
        contactKeys.add(key);
        contacts.push(contact);
      }
    }
    for (const renewal of asArray(other.renewals)) {
      const key = renewalKey(renewal);
      if (!renewalKeys.has(key)) {
        renewalKeys.add(key);
        renewals.push(renewal);
      }
    }
    for (const award of asArray(other.contract_awards)) awards.add(String(award));
    for (const [key, value] of Object.entries((other.extras ?? {}) as Record<string, unknown>)) {
      if (!(key in extras) && value) extras[key] = value;
    }
    // Fill empty domain sections from the other lead.
    for (const section of ['company', 'workers_comp', 'pension', 'benefits', 'liability', 'osha', 'dot', 'financials_990', 'demographics', 'compliance', 'coverage', 'current_carrier', 'vehicles', 'kind']) {
      const current = merged[section];
      const incoming = other[section];
      const currentEmpty =
        current === null ||
        current === undefined ||
        (typeof current === 'object' && current !== null && Object.values(current as Record<string, unknown>).every((v) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)));
      if (currentEmpty && incoming !== null && incoming !== undefined) {
        merged[section] = incoming;
      }
    }
  }

  merged.contacts = contacts;
  merged.renewals = renewals;
  if (awards.size > 0) merged.contract_awards = [...awards];
  merged.extras = extras;
  return merged;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as MergePayload;
  const survivorId = payload.survivor_id?.trim();
  const mergeIds = (payload.merge_ids ?? []).filter((id) => id && id !== survivorId);

  if (!survivorId || mergeIds.length === 0) {
    return NextResponse.json({ message: 'survivor_id and merge_ids are required.' }, { status: 400 });
  }

  const allIds = [survivorId, ...mergeIds];
  const { data, error } = await supabase.from('leads').select('*').in('id', allIds);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const rows = (data ?? []) as LeadRow[];
  const survivor = rows.find((row) => row.id === survivorId);
  const others = rows.filter((row) => row.id !== survivorId);
  if (!survivor || others.length === 0) {
    return NextResponse.json({ message: 'Leads not found.' }, { status: 404 });
  }

  const fields = payload.fields ?? {};
  const survivorProfile = (survivor.form_payload?.profile ?? {}) as Record<string, unknown>;
  const otherProfiles = others.map((row) => (row.form_payload?.profile ?? {}) as Record<string, unknown>);
  const mergedProfile = mergeProfiles(survivorProfile, otherProfiles);

  const coalesce = <T,>(preferred: T | null | undefined, ...rest: (T | null | undefined)[]): T | null => {
    if (preferred !== null && preferred !== undefined && preferred !== ('' as unknown as T)) return preferred;
    for (const value of rest) {
      if (value !== null && value !== undefined && value !== ('' as unknown as T)) return value;
    }
    return null;
  };

  const maxPremium = Math.max(premiumOf(survivor.estimated_premium), ...others.map((row) => premiumOf(row.estimated_premium)));

  const updates: Record<string, unknown> = {
    full_name: fields.full_name?.trim() || survivor.full_name,
    email: fields.email !== undefined ? fields.email : coalesce(survivor.email, ...others.map((row) => row.email)),
    phone: fields.phone !== undefined ? fields.phone : coalesce(survivor.phone, ...others.map((row) => row.phone)),
    address: fields.address !== undefined ? fields.address : coalesce(survivor.address, ...others.map((row) => row.address)),
    line_of_business:
      fields.line_of_business !== undefined
        ? fields.line_of_business
        : coalesce(survivor.line_of_business, ...others.map((row) => row.line_of_business)),
    estimated_premium:
      fields.estimated_premium !== undefined ? premiumOf(fields.estimated_premium) : maxPremium > 0 ? maxPremium : null,
    form_payload: {
      ...(survivor.form_payload ?? {}),
      profile: mergedProfile,
      merged_from: [
        ...asArray((survivor.form_payload ?? {}).merged_from),
        ...others.map((row) => ({ id: row.id, full_name: row.full_name, merged_at: new Date().toISOString() })),
      ],
    },
  };

  // Pull every enrichment column the survivor is missing from the duplicates.
  for (const column of COALESCE_COLUMNS) {
    const survivorValue = survivor[column];
    const hasValue = survivorValue !== null && survivorValue !== undefined && survivorValue !== '';
    if (hasValue) continue;
    for (const other of others) {
      const otherValue = other[column];
      if (otherValue !== null && otherValue !== undefined && otherValue !== '') {
        updates[column] = otherValue;
        break;
      }
    }
  }

  const updateRes = await supabase.from('leads').update(updates).eq('id', survivorId);
  if (updateRes.error) return NextResponse.json({ message: updateRes.error.message }, { status: 500 });

  // Repoint children, then remove the absorbed leads.
  const mergeIdList = others.map((row) => row.id);
  const [tasksRes, interactionsRes] = await Promise.all([
    supabase.from('tasks').update({ related_id: survivorId }).eq('related_type', 'lead').in('related_id', mergeIdList),
    supabase.from('interactions').update({ lead_id: survivorId }).in('lead_id', mergeIdList),
  ]);
  if (tasksRes.error) return NextResponse.json({ message: tasksRes.error.message }, { status: 500 });
  if (interactionsRes.error) return NextResponse.json({ message: interactionsRes.error.message }, { status: 500 });

  const deleteRes = await supabase.from('leads').delete().in('id', mergeIdList);
  if (deleteRes.error) return NextResponse.json({ message: deleteRes.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, survivor_id: survivorId, merged: mergeIdList.length }, { status: 200 });
}
