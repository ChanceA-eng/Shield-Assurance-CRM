import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { findDuplicateGroups, type IdentityRecord } from '../../../../lib/lead-identity';

interface LeadRow extends IdentityRecord {
  address: string | null;
  line_of_business: string | null;
  source: string | null;
  status: string;
  estimated_premium: number | string | null;
  created_at: string;
  form_payload: Record<string, unknown> | null;
}

function richness(lead: LeadRow): number {
  const profile = (lead.form_payload?.profile ?? {}) as Record<string, unknown>;
  let score = 0;
  if (Array.isArray(profile.contacts)) score += (profile.contacts as unknown[]).length * 2;
  if (Array.isArray(profile.renewals)) score += (profile.renewals as unknown[]).length * 3;
  for (const key of ['workers_comp', 'pension', 'benefits', 'dot', 'financials_990']) {
    const section = profile[key] as Record<string, unknown> | undefined;
    if (section && Object.values(section).some((value) => value !== null && value !== undefined && value !== '')) score += 2;
  }
  if (lead.email) score += 1;
  if (lead.phone) score += 1;
  return score;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('leads')
    .select('id,full_name,email,phone,address,line_of_business,source,status,estimated_premium,created_at,form_payload')
    .limit(1000);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as LeadRow[];
  const groups = findDuplicateGroups(leads).map((group) => {
    const ranked = [...group.records].sort((a, b) => richness(b) - richness(a));
    return {
      reason: group.reason,
      suggested_survivor: ranked[0].id,
      leads: ranked.map((lead) => ({
        id: lead.id,
        full_name: lead.full_name,
        email: lead.email,
        phone: lead.phone,
        address: lead.address,
        line_of_business: lead.line_of_business,
        source: lead.source,
        status: lead.status,
        estimated_premium: lead.estimated_premium,
        created_at: lead.created_at,
        richness: richness(lead),
        contacts: Array.isArray((lead.form_payload?.profile as Record<string, unknown> | undefined)?.contacts)
          ? ((lead.form_payload?.profile as Record<string, unknown>).contacts as unknown[]).length
          : 0,
        renewals: Array.isArray((lead.form_payload?.profile as Record<string, unknown> | undefined)?.renewals)
          ? ((lead.form_payload?.profile as Record<string, unknown>).renewals as unknown[]).length
          : 0,
      })),
    };
  });

  return NextResponse.json({ groups }, { status: 200 });
}
