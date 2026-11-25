import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../lib/api-auth';
import { databaseError, workspaceApiError } from '../../../../../lib/workspace-api';
import { isUuid } from '../../../../../lib/workspace-validation';
import { hasUnrestrictedConversationAccess } from '../../../../../lib/staff-workspace';

import { friendlyErrorMessage } from '../../../../../lib/workspace-api';
interface RouteContext {
  params: Promise<{ id: string }>;
}

interface LeadRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  account_id: string | null;
}

/**
 * Conversations use an explicit account link, never a guessed name/email match.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!isUuid(leadId)) {
    return NextResponse.json({ message: 'A valid lead id is required.' }, { status: 400 });
  }

  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483447) return NextResponse.json({ message: 'Choose a valid message page.' }, { status: 400 });
  if (session.teamAccess?.mode === 'restricted' && !hasUnrestrictedConversationAccess(session.teamAccess)) {
    try {
      const { data, error } = await supabase.rpc('team_conversation_thread', {
        p_actor: session.user.id, p_type: 'lead', p_id: leadId, p_offset: offset, p_limit: 100,
      });
      if (error) throw databaseError(error);
      if (!data) return NextResponse.json({ message: 'The conversation could not be loaded.' }, { status: 500 });
      return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) { return workspaceApiError(error, 'lead-conversation/read'); }
  }

  const leadResult = await supabase
    .from('leads')
    .select('id,full_name,email,phone,account_id')
    .eq('id', leadId)
    .maybeSingle<LeadRow>();

  if (leadResult.error) {
    return NextResponse.json({ message: friendlyErrorMessage(leadResult.error) }, { status: 500 });
  }

  const lead = leadResult.data;
  if (!lead) {
    return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
  }

  const clientId = lead.account_id;
  // Messages from a lead with no account yet are tagged with metadata.lead_id by the inbound webhooks.
  const { data, count, error } = await supabase.from('canonical_communications').select('*', { count: 'exact' })
    .eq('conversation_key', clientId ? `client:${clientId}` : `lead:${lead.id}`)
    .order('sent_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99);

  if (error) {
    return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ clientId, items: data ?? [], total: count ?? 0, nextOffset: offset + (data?.length ?? 0) < (count ?? 0) ? offset + (data?.length ?? 0) : null }, { status: 200 });
}
