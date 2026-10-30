import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** Full lead record, including the structured vendor profile. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
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

  const { data, error } = await supabase.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ message: 'Lead not found.' }, { status: 404 });

  return NextResponse.json(data, { status: 200 });
}
