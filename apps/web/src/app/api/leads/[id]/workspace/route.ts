import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface LeadRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const leadId = params.id?.trim();
  if (!leadId) {
    return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });
  }

  const leadResult = await supabase
    .from('leads')
    .select('id,full_name,email,phone,source')
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
    const created = await supabase
      .from('clients')
      .insert([
        {
          full_name: lead.full_name,
          email: lead.email,
          phone: lead.phone,
          source: lead.source,
        },
      ])
      .select('id')
      .single<{ id: string }>();

    if (created.error) {
      return NextResponse.json({ message: created.error.message }, { status: 500 });
    }

    clientId = created.data.id;
  }

  return NextResponse.json(
    {
      leadId: lead.id,
      clientId,
    },
    { status: 200 },
  );
}
