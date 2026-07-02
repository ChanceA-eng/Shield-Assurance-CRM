import { getSupabaseServerClient } from './supabase-server';
import { sendEmail } from './messaging';
import { appendAgencySignature } from './agency-signature';

export type AutomationChannel = 'email' | 'sms' | 'in_app';
export type AutomationType = 'renewal' | 'claim' | 'endorsement' | 'lead' | 'appointment' | 'certificate';

export interface ClientPreferences {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  email_consent?: boolean | null;
  sms_consent?: boolean | null;
  preferred_channel?: string | null;
}

export interface AutomationLogInput {
  client_id?: string | null;
  channel: AutomationChannel;
  subject: string;
  body: string;
  automation_type: AutomationType;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBeforeISO(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function isMissingColumnError(message: string | undefined): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('column') ||
    normalized.includes('schema cache') ||
    normalized.includes('does not exist') ||
    normalized.includes('relation')
  );
}

async function safeInsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const result = await supabase.from(table).insert(rows);
  if (result.error && !isMissingColumnError(result.error.message)) {
    throw result.error;
  }
}

export async function getClientPreferences(clientId: string): Promise<ClientPreferences | null> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('clients')
    .select('id,full_name,phone,email,email_consent,sms_consent,preferred_channel')
    .eq('id', clientId)
    .maybeSingle();

  if (error) return null;
  return data ?? null;
}

export async function writeNotification(input: { client_id?: string | null; type: AutomationType; message: string }): Promise<void> {
  try {
    await safeInsert('notifications', [
      {
        client_id: input.client_id ?? null,
        type: input.type,
        message: input.message,
        read: false,
      },
    ]);
  } catch {
    // Intentionally swallow: notifications are best-effort until schema is finalized.
  }
}

export async function writeCommunicationLog(input: AutomationLogInput): Promise<void> {
  try {
    await safeInsert('communication_log', [
      {
        client_id: input.client_id ?? null,
        channel: input.channel,
        subject: input.subject,
        body: input.body,
        automation_type: input.automation_type,
        sent_at: new Date().toISOString(),
      },
    ]);
  } catch {
    // Best-effort audit trail.
  }
}

export async function queueInternalAction(input: {
  clientId?: string | null;
  type: AutomationType;
  title: string;
  dueDate?: string | null;
  relatedType?: string | null;
  relatedId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await supabase.from('tasks').insert([
    {
      subject: input.title,
      due_date: input.dueDate ?? todayISO(),
      priority: 'medium',
      status: 'open',
      related_type: input.relatedType ?? input.type,
      related_id: input.relatedId ?? input.clientId ?? null,
    },
  ]);
}

export async function queueEvent(input: {
  title: string;
  eventDate: string;
  relatedType?: string | null;
  relatedId?: string | null;
  allDay?: boolean;
}): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  await supabase.from('events').insert([
    {
      subject: input.title,
      title: input.title,
      event_date: input.eventDate,
      all_day: input.allDay ?? true,
      status: 'scheduled',
      related_type: input.relatedType ?? null,
      related_id: input.relatedId ?? null,
    },
  ]);
}

export async function schedulePolicyRenewalLifecycle(input: {
  policyId: string;
  clientId: string;
  insuredName: string;
  carrier: string;
  lineOfBusiness: string;
  premium: number;
  renewalDate: string;
}): Promise<void> {
  const renewalTaskDate = daysBeforeISO(input.renewalDate, 45);

  await queueInternalAction({
    clientId: input.clientId,
    type: 'renewal',
    title: `Review renewal options for ${input.insuredName}`,
    dueDate: renewalTaskDate,
    relatedType: 'policy',
    relatedId: input.policyId,
  });

  await safeInsert('tasks', [
    {
      subject: `Renewal pipeline initialized for ${input.insuredName}`,
      description: 'Stage: Renewal Pending',
      due_date: renewalTaskDate,
      status: 'open',
      priority: 'medium',
      related_type: 'renewal_pipeline',
      related_id: input.policyId,
    },
  ]);

  await writeNotification({
    client_id: input.clientId,
    type: 'renewal',
    message: `Renewal approaching for ${input.insuredName} - expires on ${input.renewalDate}.`,
  });

  await safeInsert('client_assets', [
    {
      client_id: input.clientId,
      title: `Renewal Insight - ${input.insuredName}`,
      asset_type: 'renewal_insight',
      value: `${input.carrier} | ${input.lineOfBusiness}`,
      metadata: {
        policy_id: input.policyId,
        current_premium: input.premium,
        carrier: input.carrier,
        renewal_stage: 'Renewal Pending',
        suggested_upsell_lines: ['Workers Comp', 'Commercial Auto', 'Umbrella'],
      },
    },
  ]);
}

async function sendEmailIfAllowed(client: ClientPreferences | null, subject: string, body: string, automationType: AutomationType): Promise<void> {
  if (!client?.email || !client.email_consent) return;

  const signedBody = appendAgencySignature(body, 'system');

  try {
    await sendEmail({ to: client.email, subject, body: signedBody });
    await writeCommunicationLog({
      client_id: client.id,
      channel: 'email',
      subject,
      body: signedBody,
      automation_type: automationType,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown email delivery failure';
    await writeNotification({
      client_id: client.id,
      type: automationType,
      message: `Email delivery failed for ${subject}: ${detail}`,
    });
  }
}

async function sendSmsIfAllowed(client: ClientPreferences | null, body: string, automationType: AutomationType): Promise<void> {
  if (!client?.phone || !client.sms_consent) return;
  await writeCommunicationLog({
    client_id: client.id,
    channel: 'sms',
    subject: 'SMS Notification',
    body,
    automation_type: automationType,
  });
}

export async function runRenewalAutomation(): Promise<{ processed: number }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return { processed: 0 };

  const reminderOffsets = [45, 30, 15, 3, 0] as const;
  let processed = 0;

  for (const daysBeforeRenewal of reminderOffsets) {
    const reminderDate = new Date();
    reminderDate.setUTCDate(reminderDate.getUTCDate() + daysBeforeRenewal);
    const reminderISO = reminderDate.toISOString().slice(0, 10);

    const { data: policies } = await supabase
      .from('policies')
      .select('id,client_id,insured_name,carrier,renewal_date,status')
      .eq('renewal_date', reminderISO)
      .in('status', ['active', 'issued']);

    for (const policy of policies ?? []) {
      processed += 1;
      const client = await getClientPreferences(policy.client_id as string);
      const renewalLabel = daysBeforeRenewal === 0 ? 'today' : `in ${daysBeforeRenewal} days`;
      const title = `Renewal ${renewalLabel}: ${policy.insured_name ?? 'Policy'}`;
      const body = `Policy ${policy.insured_name ?? ''} with ${policy.carrier ?? 'your carrier'} renews on ${policy.renewal_date}.`;

      await queueInternalAction({
        clientId: policy.client_id,
        type: 'renewal',
        title: `Call client about renewal: ${policy.insured_name ?? 'Policy'}`,
        dueDate: policy.renewal_date,
        relatedType: 'policy',
        relatedId: policy.id,
      });

      await queueEvent({
        title: `Renewal review: ${policy.insured_name ?? 'Policy'}`,
        eventDate: policy.renewal_date,
        relatedType: 'policy',
        relatedId: policy.id,
        allDay: true,
      });

      await writeNotification({
        client_id: policy.client_id,
        type: 'renewal',
        message: body,
      });

      await sendEmailIfAllowed(client, title, body, 'renewal');
      await sendSmsIfAllowed(client, `Shield Assurance: ${body}`, 'renewal');
    }
  }

  return { processed };
}

export async function processClaimCreated(input: {
  claimId: string;
  clientId: string;
  insuredName?: string | null;
  claimType?: string | null;
}): Promise<void> {
  const client = await getClientPreferences(input.clientId);
  const title = `Claim received: ${input.insuredName ?? 'Client'}`;
  const body = `We received your ${input.claimType ?? 'claim'}. We\'ll follow up with next steps shortly.`;

  await queueInternalAction({
    clientId: input.clientId,
    type: 'claim',
    title: `Call client about claim: ${input.insuredName ?? 'Client'}`,
    dueDate: todayISO(),
    relatedType: 'claim',
    relatedId: input.claimId,
  });

  await writeNotification({ client_id: input.clientId, type: 'claim', message: body });
  await sendEmailIfAllowed(client, title, body, 'claim');
  await sendSmsIfAllowed(client, `Shield Assurance: ${body}`, 'claim');
}

export async function processEndorsementCreated(input: {
  endorsementId: string;
  clientId: string;
  insuredName?: string | null;
  type?: string | null;
}): Promise<void> {
  const client = await getClientPreferences(input.clientId);
  const body = `We created your ${input.type ?? 'endorsement'} request for ${input.insuredName ?? 'your policy'}.`;

  await queueInternalAction({
    clientId: input.clientId,
    type: 'endorsement',
    title: `Review endorsement: ${input.insuredName ?? 'Policy'}`,
    dueDate: todayISO(),
    relatedType: 'endorsement',
    relatedId: input.endorsementId,
  });

  await writeNotification({ client_id: input.clientId, type: 'endorsement', message: body });
  await sendEmailIfAllowed(client, 'Endorsement received', body, 'endorsement');
}

export async function processCertificateCreated(input: {
  certificateId: string;
  clientId: string;
  insuredName?: string | null;
  certificateHolder?: string | null;
}): Promise<void> {
  const client = await getClientPreferences(input.clientId);
  const body = `Your certificate for ${input.insuredName ?? 'policy'} has been issued.`;

  await writeNotification({ client_id: input.clientId, type: 'certificate', message: body });
  await sendEmailIfAllowed(client, 'Certificate issued', body, 'certificate');
  if (input.certificateHolder) {
    await writeCommunicationLog({
      client_id: input.clientId,
      channel: 'email',
      subject: `Certificate sent to ${input.certificateHolder}`,
      body: `Issued certificate for ${input.insuredName ?? 'policy'} sent to ${input.certificateHolder}.`,
      automation_type: 'certificate',
    });
  }
}

export async function processLeadStatusChanged(input: {
  leadId: string;
  leadName?: string | null;
  status: string;
}): Promise<void> {
  const body = `Lead ${input.leadName ?? input.leadId} moved to ${input.status}.`;
  await writeNotification({ client_id: null, type: 'lead', message: body });
}

export async function createDashboardAutomationAlerts(): Promise<void> {
  const supabase = getSupabaseServerClient();
  if (!supabase) return;

  const [renewals, claims, endorsements, overdueTasks, todayEvents, leadFollowUps] = await Promise.all([
    supabase.from('policies').select('id,client_id,insured_name,renewal_date').gte('renewal_date', todayISO()).lte('renewal_date', (() => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString().slice(0, 10);
    })()).limit(20),
    supabase.from('claims').select('id').eq('status', 'open').limit(20),
    supabase.from('endorsements').select('id').eq('status', 'open').limit(20),
    supabase.from('tasks').select('id').eq('status', 'open').lt('due_date', todayISO()).limit(20),
    supabase.from('events').select('id').eq('event_date', todayISO()).limit(20),
    supabase.from('leads').select('id').in('status', ['new', 'working']).limit(20),
  ]);

  await safeInsert('notifications', [
    { client_id: null, type: 'renewal', message: `Renewals due: ${(renewals.data ?? []).length}`, read: false },
    { client_id: null, type: 'claim', message: `Claims needing attention: ${(claims.data ?? []).length}`, read: false },
    { client_id: null, type: 'endorsement', message: `Endorsements pending: ${(endorsements.data ?? []).length}`, read: false },
    { client_id: null, type: 'lead', message: `Lead follow-ups: ${(leadFollowUps.data ?? []).length}`, read: false },
    { client_id: null, type: 'appointment', message: `Events today: ${(todayEvents.data ?? []).length}`, read: false },
    { client_id: null, type: 'renewal', message: `Overdue tasks: ${(overdueTasks.data ?? []).length}`, read: false },
  ]);
}
