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

  if (!clientId) {
    return NextResponse.json({ clientId: null, items: [] }, { status: 200 });
  }

  const { data, error } = await supabase
    .from('communication_log')
    .select('*')
    .eq('client_id', clientId)
    .order('sent_at', { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json({ clientId, items: data ?? [] }, { status: 200 });
}
