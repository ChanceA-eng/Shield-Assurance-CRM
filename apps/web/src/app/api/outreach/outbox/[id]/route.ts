import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../lib/api-auth';
import { finalizeAcceptedOutbox, sendOutboxItem } from '../../../../../lib/outreach-engine';
import { agencyEnabled } from '../../../../../lib/agency-membership';

import { friendlyErrorMessage } from '../../../../../lib/workspace-api';
interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Approve-and-send (with optional edits) or reject a pending outbox draft. */
export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { id } = await context.params;
  const outboxId = id?.trim();
  if (!outboxId) return NextResponse.json({ message: 'Outbox id is required.' }, { status: 400 });

  const payload = (await request.json().catch(() => ({}))) as {
    action?: 'approve_send' | 'reject' | 'finish_recording';
    subject?: string;
    body?: string;
    revision?: number;
  };
  {
    const owned = await supabase.from('outreach_outbox').select('agent_user_id,prospecting_touch_id').eq('id', outboxId).single();
    if (owned.error) return NextResponse.json({ message: 'Outreach ownership could not be verified.' }, { status: 503 });
    if ((agencyEnabled() || owned.data.prospecting_touch_id) && owned.data.agent_user_id !== session.user.id) {
      return NextResponse.json({ message: 'Only the plan owner can manage this send.' }, { status: 403 });
    }
  }

  if (payload.action === 'reject') {
    const { error } = await supabase
      .from('outreach_outbox')
      .update({ status: 'rejected', error: 'Rejected by producer.' })
      .eq('id', outboxId)
      .eq('status', 'pending_approval');
    if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (payload.action === 'approve_send' || payload.action === 'finish_recording') {
    if (payload.action === 'approve_send' && (typeof payload.revision !== 'number'
      || !Number.isSafeInteger(payload.revision) || payload.revision < 0)) {
      return NextResponse.json({ message: 'Refresh and review the current draft before approving.' }, { status: 400 });
    }
    try {
      // Recording-only recovery cannot invoke a provider, even for an invalid/uncertain item.
      const result = payload.action === 'finish_recording'
        ? await finalizeAcceptedOutbox(supabase, outboxId)
        : await sendOutboxItem(supabase, outboxId, { subject: payload.subject, body: payload.body, revision: payload.revision }, session.user.id);
      if (!result.sent) return NextResponse.json({ message: result.message ?? 'Send failed.' }, { status: 502 });
      return NextResponse.json({ ok: true, delivery_status: result.deliveryStatus, message: result.message }, { status: 200 });
    } catch (error) {
      return NextResponse.json({ message: error instanceof Error ? error.message : 'Outreach action failed. Refresh before retrying; do not resend uncertain attempts.' }, { status: 500 });
    }
  }

  return NextResponse.json({ message: 'action must be approve_send, reject, or finish_recording.' }, { status: 400 });
}
