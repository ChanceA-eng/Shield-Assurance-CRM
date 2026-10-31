import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { isUuid } from '../../../../lib/workspace-validation';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Full lead record, including the structured vendor profile. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!isUuid(leadId)) {
    return NextResponse.json({ message: 'A valid lead id is required.' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('lead_profile_snapshot', { p_lead_id: leadId });
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });

  return NextResponse.json(data, { status: 200 });
}
