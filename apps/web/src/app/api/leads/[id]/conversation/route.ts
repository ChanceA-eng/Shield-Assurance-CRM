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
}

/**
 * Lead conversation: finds the matching client record (email -> phone -> name,
 * never creates one) and returns its communication log. Lead-era messages land
 * on the client record so the full history survives conversion.
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
    .select('id,full_name,email,phone')
    .eq('id', leadId)
    .maybeSingle<LeadRow>();

  if (leadResult.error) {
    return NextResponse.json({ message: leadResult.error.message }, { status: 500 });
  }

  const lead = leadResult.data;
  if (!lead) {
    return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });
  }

  let clientId: string | null = null;

  if (lead.email) {
    const byEmail = await supabase
      .from('clients')
      .select('id')
      .eq('email', lead.email)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (byEmail.error) {
      return NextResponse.json({ message: byEmail.error.message }, { status: 500 });
    }
    clientId = byEmail.data?.id ?? null;
  }

  if (!clientId && lead.phone) {
    const byPhone = await supabase
      .from('clients')
      .select('id')
      .eq('phone', lead.phone)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (byPhone.error) {
      return NextResponse.json({ message: byPhone.error.message }, { status: 500 });
    }
    clientId = byPhone.data?.id ?? null;
  }

  if (!clientId && lead.full_name) {
    const byName = await supabase
      .from('clients')
      .select('id')
      .ilike('full_name', lead.full_name)
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (byName.error) {
      return NextResponse.json({ message: byName.error.message }, { status: 500 });
    }
    clientId = byName.data?.id ?? null;
  }

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
