import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getApiSession } from '../../../../lib/api-auth';
import { accountRecordScope } from '../../../../lib/team-request-access';
import { isUuid } from '../../../../lib/workspace-validation';

import { friendlyErrorMessage } from '../../../../lib/workspace-api';
interface RouteContext {
  params: Promise<{ clientId: string }>;
}

export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const scope = accountRecordScope(session.teamAccess, 'accounts.view');
  if (!scope) return NextResponse.json({ message: 'You do not have access to accounts.' }, { status: 403 });

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });
  const query = supabase
    .from('clients')
    .select('id,full_name,phone,email,address,source,account_type,assigned_producer,csr,since_date,email_consent,sms_consent,preferred_channel,created_at,policy_effective_at,last_viewed_at,last_activity_at')
    .eq('id', clientId);
  if (scope === 'assigned') query.eq('agent_user_id', session.user.id);
  const queryResult = await query.maybeSingle();

  const { data, error } = queryResult;

  if (error) {
    return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ message: 'Client not found.' }, { status: 404 });
  }

  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}