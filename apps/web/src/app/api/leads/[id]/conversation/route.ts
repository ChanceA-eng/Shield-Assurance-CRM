import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';

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
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { id } = await context.params;
  const leadId = id?.trim();
  if (!leadId) {
    return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });
  }

  const leadResult = await supabase
    .from('leads')
    .select('id,full_name,email,phone,account_id')
    .eq('id', leadId)
    .maybeSingle<LeadRow>();

  if (leadResult.error) {
    return NextResponse.json({ message: leadResult.error.message }, { status: 500 });
  }

  const lead = leadResult.data;
  if (!lead) {
    return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
  }

  const clientId = lead.account_id;
  const offset = Number(request.nextUrl.searchParams.get('offset') ?? '0');
  if (!Number.isSafeInteger(offset) || offset < 0) return NextResponse.json({ message: 'Choose a valid message page.' }, { status: 400 });

  // Messages from a lead with no account yet are tagged with metadata.lead_id by the inbound webhooks.
  const { data, count, error } = await supabase.from('canonical_communications').select('*', { count: 'exact' })
    .eq('conversation_key', clientId ? `client:${clientId}` : `lead:${lead.id}`)
    .order('sent_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + 99);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ clientId, items: data ?? [], total: count ?? 0, nextOffset: offset + (data?.length ?? 0) < (count ?? 0) ? offset + (data?.length ?? 0) : null }, { status: 200 });
}
