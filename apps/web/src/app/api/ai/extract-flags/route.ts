import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { isUuid } from '../../../../lib/workspace-validation';

function normalize(value?: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const clientId = request.nextUrl.searchParams.get('clientId')?.trim();
  if (!isUuid(clientId)) {
    return NextResponse.json({ message: 'A valid clientId is required.' }, { status: 400 });
  }

  const [policiesRes, claimsRes, tasksRes, communicationsRes] = await Promise.all([
    supabase.from('policies').select('id,status,renewal_date').eq('client_id', clientId).limit(100),
    supabase.from('claims').select('id,status').eq('client_id', clientId).limit(100),
    supabase.from('tasks').select('id', { count: 'exact', head: true })
      .or(`account_id.eq.${clientId},and(related_type.eq.client,related_id.eq.${clientId})`)
      .eq('status', 'open').lt('due_date', new Date().toISOString()),
    supabase
      .from('communication_log')
      .select('id,direction,channel,sent_at')
      .eq('client_id', clientId)
      .in('channel', ['email', 'sms'])
      .order('sent_at', { ascending: false })
      .limit(150),
  ]);

  if (policiesRes.error) return NextResponse.json({ message: policiesRes.error.message }, { status: 500 });
  if (claimsRes.error) return NextResponse.json({ message: claimsRes.error.message }, { status: 500 });
  if (tasksRes.error) return NextResponse.json({ message: tasksRes.error.message }, { status: 500 });
  if (communicationsRes.error) return NextResponse.json({ message: communicationsRes.error.message }, { status: 500 });

  const flags: string[] = [];

  const openClaims = (claimsRes.data ?? []).filter((claim) => normalize(claim.status) === 'open').length;
  if (openClaims > 0) {
    flags.push(`${openClaims} open claim${openClaims > 1 ? 's' : ''} require active servicing.`);
  }

  const overdueTasks = tasksRes.count ?? 0;
  if (overdueTasks > 0) {
    flags.push(`${overdueTasks} overdue client task${overdueTasks > 1 ? 's' : ''} need attention.`);
  }

  const renewalsSoon = (policiesRes.data ?? []).filter((policy) => {
    if (!policy.renewal_date) return false;
    const days = Math.floor((new Date(policy.renewal_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return days >= 0 && days <= 45;
  }).length;
  if (renewalsSoon > 0) {
    flags.push(`${renewalsSoon} policy renewal${renewalsSoon > 1 ? 's are' : ' is'} due within 45 days.`);
  }

  const inbound = (communicationsRes.data ?? []).filter((item) => item.direction === 'inbound').length;
  const outbound = (communicationsRes.data ?? []).filter((item) => item.direction !== 'inbound').length;
  if (inbound > outbound + 2) {
    flags.push('Inbound communication volume is higher than outbound follow-up, which may indicate service backlog risk.');
  }

  if (flags.length === 0) {
    flags.push('No immediate underwriting or servicing flags detected from current client activity.');
  }

  const activity = await supabase.from('client_activities').insert([
    {
      client_id: clientId,
      activity_type: 'account_review',
      title: 'Reviewed account work and policy flags',
      body: flags.join(' | '),
      metadata: { source: 'api.ai.extract-flags', engine: 'rules', flag_count: flags.length },
      occurred_at: new Date().toISOString(),
    },
  ]);
  if (activity.error) return NextResponse.json({ message: activity.error.message }, { status: 500 });

  return NextResponse.json({ ok: true, flags }, { status: 200 });
}
