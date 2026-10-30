import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

/** Marks all inbound messages for a client as read (conversation was viewed). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { client_id?: string };
  const clientId = body.client_id?.trim();
  if (!clientId) {
    return NextResponse.json({ message: 'client_id is required.' }, { status: 400 });
  }

  const { error } = await supabase
    .from('communication_log')
    .update({ read_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('direction', 'inbound')
    .is('read_at', null);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 200 });
}
