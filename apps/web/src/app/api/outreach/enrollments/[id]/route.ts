import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Pause, resume, or cancel a sequence enrollment. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { id } = await context.params;
  const enrollmentId = id?.trim();
  if (!enrollmentId) return NextResponse.json({ message: 'Enrollment id is required.' }, { status: 400 });

  const payload = (await request.json().catch(() => ({}))) as { action?: 'pause' | 'resume' | 'cancel' };

  let update: Record<string, unknown>;
  if (payload.action === 'pause') {
    update = { status: 'paused' };
  } else if (payload.action === 'resume') {
    update = { status: 'active', next_send_at: new Date().toISOString() };
  } else if (payload.action === 'cancel') {
    update = { status: 'cancelled', ended_at: new Date().toISOString(), ended_reason: 'Cancelled by producer.' };
  } else {
    return NextResponse.json({ message: 'action must be pause, resume, or cancel.' }, { status: 400 });
  }

  const { error } = await supabase
    .from('sequence_enrollments')
    .update(update)
    .eq('id', enrollmentId)
    .in('status', ['active', 'paused']);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  if (payload.action === 'cancel') {
    await supabase
      .from('outreach_outbox')
      .update({ status: 'rejected', error: 'Sequence cancelled.' })
      .eq('enrollment_id', enrollmentId)
      .eq('status', 'pending_approval');
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
