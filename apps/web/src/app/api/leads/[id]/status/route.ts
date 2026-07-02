import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { processLeadStatusChanged } from '../../../../../lib/automation';

function normalizeLeadStatus(input: string): string | null {
  const value = input.trim().toLowerCase();

  const aliases: Record<string, string> = {
    lead: 'new',
    new: 'new',
    prospect: 'working',
    working: 'working',
    quoted: 'quoted',
    bound: 'closed',
    renewal: 'closed',
    closed: 'closed',
  };

  return aliases[value] ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const payload = (await request.json().catch(() => ({}))) as { status?: string };
  const statusValue = typeof payload.status === 'string' ? normalizeLeadStatus(payload.status) : null;

  if (!statusValue) {
    return NextResponse.json({ message: 'A valid status is required.' }, { status: 400 });
  }

  const leadId = params.id?.trim();
  if (!leadId) {
    return NextResponse.json({ message: 'Lead id is required.' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('leads')
    .update({ status: statusValue })
    .eq('id', leadId)
    .select('*')
    .single();

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  await processLeadStatusChanged({
    leadId: data.id,
    leadName: data.full_name,
    status: data.status,
  });

  return NextResponse.json(data, { status: 200 });
}
