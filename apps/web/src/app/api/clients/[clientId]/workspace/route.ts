import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';

interface RouteContext {
  params: Promise<{ clientId: string }>;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

function normalize(value?: string | null): string {
  return (value ?? '').trim();
}

function isMissingRelationError(message: string | undefined): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return (
    lower.includes("could not find the table") ||
    lower.includes('relation') ||
    lower.includes('schema cache') ||
    lower.includes('does not exist')
  );
}

function shouldIgnoreQueryError(key: string, message: string | undefined): boolean {
  if (!isMissingRelationError(message)) return false;

  const optionalKeys = new Set([
    'claims',
    'endorsements',
    'certificates',
    'assets',
    'clientTasks',
    'files',
    'tags',
    'activities',
    'timelineTasks',
    'events',
    'leadsByEmail',
    'leadsByPhone',
    'leadsByName',
  ]);

  return optionalKeys.has(key);
}

function safeData<T>(key: string, result: QueryResult<T>): T[] {
  if (result.error && shouldIgnoreQueryError(key, result.error.message)) {
    return [];
  }
  return (result.data ?? []) as T[];
}

export async function GET(_request: Request, context: RouteContext): Promise<NextResponse> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { clientId } = await context.params;
  const requestUrl = new URL(_request.url);
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
    .select('id,full_name,phone,email,address,source,email_consent,sms_consent,preferred_channel,created_at')
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
    assetsRes,
    clientTasksRes,
    filesRes,
    tagsRes,
    activitiesRes,
  ] = await Promise.all([
    supabase
      .from('policies')
      .select('id,client_id,insured_name,carrier,line_of_business,premium,policy_number,effective_date,renewal_date,status,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
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
    supabase
      .from('tasks')
      .select('*')
      .eq('related_type', 'client')
      .eq('related_id', clientId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(timelineLimit),
    supabase
      .from('events')
      .select('*')
      .eq('related_type', 'client')
      .eq('related_id', clientId)
      .order('event_date', { ascending: false })
      .limit(timelineLimit),
    supabase.from('claims').select('id,client_id,type,status,description,date_of_loss,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(100),
    supabase
      .from('endorsements')
      .select('id,client_id,type,status,description,effective_date,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('certificates')
      .select('id,client_id,certificate_holder,status,description,issue_date,created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase.from('client_assets').select('id,client_id,title,asset_type,value,metadata,created_at,updated_at').eq('client_id', clientId).order('updated_at', { ascending: false }).limit(200),
    supabase.from('client_tasks').select('id,client_id,subject,description,due_date,status,priority,created_at,updated_at').eq('client_id', clientId).order('due_date', { ascending: true, nullsFirst: false }).limit(200),
    supabase.from('client_files').select('id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at').eq('client_id', clientId).order('uploaded_at', { ascending: false }).limit(200),
    supabase.from('client_tags').select('id,client_id,tag,color,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(200),
    supabase
      .from('client_activities')
      .select('id,client_id,activity_type,title,body,metadata,occurred_at,created_at')
      .eq('client_id', clientId)
      .order('occurred_at', { ascending: false })
      .limit(activityLimit),
  ]);

  const namedResponses: Record<string, QueryResult<unknown>> = {
    policies: policiesRes,
    communications: communicationsRes,
    scheduledMessages: scheduledRes,
    notifications: notificationsRes,
    timelineTasks: tasksRes,
    events: eventsRes,
    claims: claimsRes,
    endorsements: endorsementsRes,
    certificates: certificatesRes,
    assets: assetsRes,
    clientTasks: clientTasksRes,
    files: filesRes,
    tags: tagsRes,
    activities: activitiesRes,
  };

  for (const [key, result] of Object.entries(namedResponses)) {
    if (result.error && !shouldIgnoreQueryError(key, result.error.message)) {
      return NextResponse.json({ message: result.error.message ?? 'Failed to load client workspace data.' }, { status: 500 });
    }
  }

  const email = normalize(client.email).toLowerCase();
  const phone = normalize(client.phone);
  const fullName = normalize(client.full_name);

  const leadLookups = await Promise.all([
    email
      ? supabase.from('leads').select('id,full_name,phone,email,line_of_business,source,status,created_at').ilike('email', email).order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
    phone
      ? supabase.from('leads').select('id,full_name,phone,email,line_of_business,source,status,created_at').eq('phone', phone).order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
    fullName
      ? supabase.from('leads').select('id,full_name,phone,email,line_of_business,source,status,created_at').ilike('full_name', fullName).order('created_at', { ascending: false }).limit(50)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const leadEntries = [
    { key: 'leadsByEmail', result: leadLookups[0] },
    { key: 'leadsByPhone', result: leadLookups[1] },
    { key: 'leadsByName', result: leadLookups[2] },
  ];

  for (const entry of leadEntries) {
    if (entry.result.error && !shouldIgnoreQueryError(entry.key, entry.result.error.message)) {
      return NextResponse.json({ message: entry.result.error.message ?? 'Failed to load leads for this client.' }, { status: 500 });
    }
  }

  const leadMap = new Map<string, Record<string, unknown>>();
  leadLookups.forEach((result) => {
    (result.data ?? []).forEach((lead) => {
      leadMap.set(lead.id as string, lead as Record<string, unknown>);
    });
  });

  return NextResponse.json(
    {
      client,
      policies: safeData('policies', policiesRes),
      leads: Array.from(leadMap.values()),
      communications: safeData('communications', communicationsRes),
      scheduledMessages: safeData('scheduledMessages', scheduledRes),
      notifications: safeData('notifications', notificationsRes),
      timelineTasks: safeData('timelineTasks', tasksRes),
      events: safeData('events', eventsRes),
      claims: safeData('claims', claimsRes),
      endorsements: safeData('endorsements', endorsementsRes),
      certificates: safeData('certificates', certificatesRes),
      assets: safeData('assets', assetsRes),
      clientTasks: safeData('clientTasks', clientTasksRes),
      files: safeData('files', filesRes),
      tags: safeData('tags', tagsRes),
      activities: safeData('activities', activitiesRes),
    },
    { status: 200 },
  );
}
