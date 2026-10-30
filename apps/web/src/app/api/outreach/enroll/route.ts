import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { enrollLead } from '../../../../lib/outreach-engine';

/** Returns the live enrollment (if any) for a lead — used by the lead drawer. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const leadId = request.nextUrl.searchParams.get('lead_id')?.trim();
  if (!leadId) return NextResponse.json({ message: 'lead_id is required.' }, { status: 400 });

  const { data } = await supabase
    .from('sequence_enrollments')
    .select('id,status,current_step,total_steps,next_send_at')
    .eq('lead_id', leadId)
    .order('enrolled_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ enrollment: data ?? null }, { status: 200 });
}

/** Enrolls a lead into the email sequence and drafts step 1 immediately. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const payload = (await request.json().catch(() => ({}))) as { lead_id?: string };
  const leadId = payload.lead_id?.trim();
  if (!leadId) return NextResponse.json({ message: 'lead_id is required.' }, { status: 400 });

  const result = await enrollLead(supabase, leadId);
  if (!result.enrollment) {
    return NextResponse.json({ message: result.message ?? 'Enrollment failed.' }, { status: 409 });
  }
  return NextResponse.json(
    {
      enrollment: result.enrollment,
      drafted: result.drafted,
      message: result.drafted
        ? 'Enrolled — the first email is waiting in the outbox for your approval.'
        : 'Enrolled, but the first draft could not be generated yet. Use "Run engine" on the Outreach page to retry.',
    },
    { status: 201 },
  );
}
