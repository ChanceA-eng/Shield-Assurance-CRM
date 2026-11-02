import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { requireApiSession } from '../../../../../lib/api-auth';

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
  const requestUrl = new URL(request.url);
  const coreOnly = requestUrl.searchParams.get('mode') === 'core';
  const omitted = Promise.resolve({ data: [], error: null });
  const timelineLimitParam = Number(requestUrl.searchParams.get('timelineLimit') ?? '120');
  const activityLimitParam = Number(requestUrl.searchParams.get('activityLimit') ?? '80');
  const timelineLimit = Number.isFinite(timelineLimitParam)
    ? Math.max(25, Math.min(400, Math.floor(timelineLimitParam)))
    : 120;
  const activityLimit = Number.isFinite(activityLimitParam)
    ? Math.max(20, Math.min(400, Math.floor(activityLimitParam)))
    : 80;

  const clientQuery = await supabase
    .from('clients')
    .select('id,full_name,phone,email,address,source,account_type,assigned_producer,csr,since_date,email_consent,sms_consent,preferred_channel,created_at,policy_effective_at,last_viewed_at,last_activity_at')
    .eq('id', clientId)
    .maybeSingle();

  if (clientQuery.error) {
    return NextResponse.json({ message: clientQuery.error.message }, { status: 500 });
  }

  if (!clientQuery.data) {
    return NextResponse.json({ message: 'Client not found.' }, { status: 404 });
  }

  const client = clientQuery.data;

  const [
    policiesRes,
    communicationsRes,
    scheduledRes,
    notificationsRes,
    tasksRes,
    eventsRes,
    claimsRes,
    endorsementsRes,
    certificatesRes,
    applicationsRes,
    campaignsRes,
    assetsRes,
    filesRes,
    tagsRes,
    activitiesRes,
    linkedLeads,
  ] = await Promise.all([
    supabase
      .from('policies')
      .select('id,client_id,account_id,insured_name,carrier,line_of_business,sub_type,premium,policy_number,effective_date,renewal_date,expiration_date,status,billing_type,source,prior_policy_id,created_at,quote_option_id,quote_snapshot')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(200),
    coreOnly ? omitted : supabase
      .from('communication_log')
      .select('*')
      .eq('client_id', clientId)
      .order('sent_at', { ascending: false })
      .limit(timelineLimit),
    supabase
      .from('scheduled_messages')
      .select('*')
      .eq('client_id', clientId)
      .order('send_at', { ascending: true })
      .limit(Math.max(50, Math.floor(timelineLimit / 2))),
    supabase
      .from('notifications')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(Math.max(50, Math.floor(timelineLimit / 2))),
    coreOnly ? omitted : supabase
      .from('tasks')
      .select('*')
      .or(`account_id.eq.${clientId},and(related_type.eq.client,related_id.eq.${clientId})`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(timelineLimit),
    supabase
      .from('events')
      .select('*')
      .eq('related_type', 'client')
      .eq('related_id', clientId)
      .order('event_date', { ascending: false })
      .limit(timelineLimit),
    supabase.from('claims').select('id,client_id,account_id,policy_id,claim_number,type,status,description,date_of_loss,adjuster_name,adjuster_contact,reserve_amount,payout_amount,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(100),
    supabase
      .from('endorsements')
      .select('id,client_id,type,status,description,effective_date,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('certificates')
      .select('id,client_id,account_id,policy_id,certificate_holder,holder_name,holder_address,status,description,issue_date,issued_date,expiration_date,coverage_summary,file_path,is_master,master_template_id,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('applications')
      .select('id,account_id,line_of_business,status,created_at,updated_at')
      .eq('account_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('campaigns')
      .select('id,name,status,account_id,list_name,scheduled_at,sent_at,created_at,updated_at')
      .or(`account_id.eq.${clientId},account_id.is.null`)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('client_assets').select('id,client_id,lead_id,title,asset_type,value,metadata,archived_at,created_at,updated_at').eq('client_id', clientId).is('archived_at', null).order('updated_at', { ascending: false }).limit(200),
    coreOnly ? omitted : supabase.from('client_files').select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at').eq('client_id', clientId).order('uploaded_at', { ascending: false }).limit(200),
    supabase.from('client_tags').select('id,client_id,tag,color,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
    supabase
      .from('client_activities')
      .select('id,client_id,activity_type,title,body,metadata,occurred_at,created_at')
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(activityLimit),
    supabase.from('leads')
      .select('id,full_name,phone,email,line_of_business,source,status,created_at,last_viewed_at,last_activity_at')
      .eq('account_id', clientId).order('created_at', { ascending: false }).limit(200),
  ]);

  const namedResponses = {
    policies: policiesRes,
    communications: communicationsRes,
    scheduledMessages: scheduledRes,
    notifications: notificationsRes,
    timelineTasks: tasksRes,
    events: eventsRes,
    claims: claimsRes,
    endorsements: endorsementsRes,
    certificates: certificatesRes,
    applications: applicationsRes,
    campaigns: campaignsRes,
    assets: assetsRes,
    files: filesRes,
    tags: tagsRes,
    activities: activitiesRes,
    leads: linkedLeads,
  };

  for (const [key, result] of Object.entries(namedResponses)) {
    if (result.error) {
      return NextResponse.json({ message: result.error.message ?? 'Failed to load client workspace data.' }, { status: 500 });
    }
  }

  return NextResponse.json(
    {
      client,
      ...(coreOnly ? { omitted_sections: ['communications', 'timelineTasks', 'files'] } : {}),
      policies: policiesRes.data ?? [],
      leads: linkedLeads.data ?? [],
      communications: communicationsRes.data ?? [],
      scheduledMessages: scheduledRes.data ?? [],
      notifications: notificationsRes.data ?? [],
      timelineTasks: tasksRes.data ?? [],
      events: eventsRes.data ?? [],
      claims: claimsRes.data ?? [],
      endorsements: endorsementsRes.data ?? [],
      certificates: certificatesRes.data ?? [],
      applications: applicationsRes.data ?? [],
      campaigns: campaignsRes.data ?? [],
      assets: assetsRes.data ?? [],
      clientTasks: tasksRes.data ?? [],
      files: filesRes.data ?? [],
      tags: tagsRes.data ?? [],
      activities: activitiesRes.data ?? [],
    },
    { status: 200 },
  );
}
