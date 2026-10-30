import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';
import { sendOutboxItem } from '../../../../../lib/outreach-engine';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Approve-and-send (with optional edits) or reject a pending outbox draft. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { id } = await context.params;
  const outboxId = id?.trim();
  if (!outboxId) return NextResponse.json({ message: 'Outbox id is required.' }, { status: 400 });

  const payload = (await request.json().catch(() => ({}))) as {
    action?: 'approve_send' | 'reject';
    subject?: string;
    body?: string;
  };

  if (payload.action === 'reject') {
    const { error } = await supabase
      .from('outreach_outbox')
      .update({ status: 'rejected', error: 'Rejected by producer.' })
      .eq('id', outboxId)
      .eq('status', 'pending_approval');
    if (error) return NextResponse.json({ message: error.message }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (payload.action === 'approve_send') {
    const result = await sendOutboxItem(supabase, outboxId, { subject: payload.subject, body: payload.body });
    if (!result.sent) return NextResponse.json({ message: result.message ?? 'Send failed.' }, { status: 502 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  return NextResponse.json({ message: 'action must be approve_send or reject.' }, { status: 400 });
}
