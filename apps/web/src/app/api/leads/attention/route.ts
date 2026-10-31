import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

export interface AttentionLead {
  id: string;
  full_name: string;
  line_of_business: string | null;
  source: string | null;
  arrived_at: string;
}

/**
 * Website leads still sitting in "new" — the banner shows these on every page
 * until the producer moves them along (or dismisses the banner).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { data, error } = await supabase
    .from('leads')
    .select('id,full_name,line_of_business,source,created_at,form_payload')
    .eq('status', 'new')
    .or('source.ilike.%website%,source.ilike.%web%,source.ilike.%intake%,source.ilike.%guided%,source.ilike.%quote%,source.ilike.%review%')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  // When THIS submission actually happened — resubmissions refresh the payload,
  // so a revived lead re-enters the banner with its new submission time.
  const submittedAt = (payload: Record<string, unknown> | null, createdAt: string): string => {
    const metadata = (payload?.metadata ?? {}) as Record<string, unknown>;
    const candidate =
      (typeof metadata.submittedAt === 'string' && metadata.submittedAt) ||
      (typeof payload?.submission_date === 'string' && payload.submission_date) ||
      createdAt;
    return Number.isNaN(new Date(candidate).getTime()) ? createdAt : candidate;
  };

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const leads: AttentionLead[] = (data ?? [])
    .map((row) => ({
      id: row.id as string,
      full_name: row.full_name as string,
      line_of_business: (row.line_of_business as string | null) ?? null,
      source: (row.source as string | null) ?? null,
      arrived_at: submittedAt(row.form_payload as Record<string, unknown> | null, row.created_at as string),
    }))
    .filter((lead) => new Date(lead.arrived_at).getTime() >= weekAgo)
    .sort((a, b) => b.arrived_at.localeCompare(a.arrived_at))
    .slice(0, 20);

  return NextResponse.json({ leads }, { status: 200 });
}
