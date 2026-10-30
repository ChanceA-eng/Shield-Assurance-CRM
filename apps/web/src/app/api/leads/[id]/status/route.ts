import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';
import { processLeadStatusChanged } from '../../../../../lib/automation';
import { normalizeLeadStatus, LOST_REASONS } from '../../../../../lib/lead-pipeline';

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface StatusPayload {
  status?: string;
  lost_reason?: string;
  estimated_premium?: number | string;
}

function parsePremium(value: number | string | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as StatusPayload;
  const statusValue = typeof payload.status === 'string' ? normalizeLeadStatus(payload.status) : null;

  if (!statusValue) {
    return NextResponse.json({ message: 'A valid status is required.' }, { status: 400 });
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!leadId) {
    return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });
  }

  const updateData: Record<string, string | number | null> = {
    status: statusValue,
    stage_changed_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  };

  if (statusValue === 'lost') {
    const reason = typeof payload.lost_reason === 'string' ? payload.lost_reason.trim().toLowerCase() : '';
    updateData.lost_reason = (LOST_REASONS as readonly string[]).includes(reason) ? reason : 'other';
  } else {
    updateData.lost_reason = null;
  }

  const premium = parsePremium(payload.estimated_premium);
  if (premium !== null) {
    updateData.estimated_premium = premium;
  }

  const { data, error } = await supabase
    .from('leads')
    .update(updateData)
    .eq('id', leadId)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  await processLeadStatusChanged({
    leadId: data.id,
    leadName: data.full_name,
    status: data.status,
  });

  return NextResponse.json(data, { status: 200 });
}
