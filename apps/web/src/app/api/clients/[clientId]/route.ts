import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

function isColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const value = message.toLowerCase();
  return value.includes('column') || value.includes('schema cache') || value.includes('does not exist');
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const queryResult = await supabase
    .from('clients')
    .select('id,full_name,phone,email,address,source,email_consent,sms_consent,preferred_channel,created_at')
    .eq('id', clientId)
    .maybeSingle();

  if (queryResult.error && isColumnError(queryResult.error.message)) {
    const fallbackQueryResult = await supabase
      .from('clients')
      .select('id,full_name,phone,email,address,source,email_consent,sms_consent,preferred_channel,created_at')
      .eq('id', clientId)
      .maybeSingle();

    if (fallbackQueryResult.error) {
      return NextResponse.json({ message: fallbackQueryResult.error.message }, { status: 500 });
    }

    if (!fallbackQueryResult.data) {
      return NextResponse.json({ message: 'Client not found.' }, { status: 404 });
    }

    return NextResponse.json(fallbackQueryResult.data, { status: 200 });
  }

  const { data, error } = queryResult;

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ message: 'Client not found.' }, { status: 404 });
  }

  return NextResponse.json(data, { status: 200 });
}