import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const queryResult = await supabase
    .from('clients')
    .select('id,full_name,phone,email,address,source,account_type,assigned_producer,csr,since_date,email_consent,sms_consent,preferred_channel,created_at,policy_effective_at,last_viewed_at,last_activity_at')
    .eq('id', clientId)
    .maybeSingle();

  const { data, error } = queryResult;

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ message: 'Client not found.' }, { status: 404 });
  }

  return NextResponse.json(data, { status: 200 });
}