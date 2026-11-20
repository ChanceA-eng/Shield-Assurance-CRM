import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { leadDeclinedContact } from '../../../../lib/message-delivery';
import { ACTIVE_LEAD_STATUSES } from '../../../../lib/lead-pipeline';
import { unsubscribeToken } from '../../../../lib/marketing-email';
import {
  addInstantlyLeads,
  createInstantlyCampaign,
  createInstantlyWebhook,
  instantlyAllowedSenderDomains,
  instantlyConfiguration,
  type InstantlyCampaignInput,
  type InstantlyLeadInput,
} from '../../../../lib/instantly';
import { assertSameOriginJson, databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { hasTeamPermission, requireTeamPermission } from '../../../../lib/team-request-access';

export const runtime = 'nodejs';
export const maxDuration = 60;

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERSONAL_MAILBOX_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
  'yahoo.com', 'icloud.com', 'aol.com',
]);

interface ReviewedDraft {
  leadId: string;
  subject: string;
  body: string;
  citedSignals: string[];
}

interface CampaignLead {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  industry: string | null;
  business: string | null;
  website: string | null;
  account_id: string | null;
  archived_at: string | null;
  status: string;
  form_payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseDrafts(value: unknown): ReviewedDraft[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
    throw new WorkspaceError('Select between 1 and 1,000 reviewed lead drafts.', 400);
  }
  const drafts = value.map((item, index): ReviewedDraft => {
    if (!isRecord(item) || typeof item.leadId !== 'string' || !UUID_PATTERN.test(item.leadId)
      || typeof item.subject !== 'string' || typeof item.body !== 'string'
      || !Array.isArray(item.citedSignals)
      || !item.citedSignals.every((signal) => typeof signal === 'string' && signal.trim().length <= 500)) {
      throw new WorkspaceError(`Reviewed draft ${index + 1} is incomplete. Generate and review each draft before creating a campaign.`, 400);
    }
    const subject = item.subject.trim();
    const body = item.body.trim();
    const citedSignals = item.citedSignals.map((signal) => signal.trim()).filter(Boolean);
    if (!subject || subject.length > 180 || body.length < 40 || body.length > 10000 || citedSignals.length === 0) {
      throw new WorkspaceError(`Reviewed draft ${index + 1} must have a subject, a message, and at least one cited grounding signal.`, 400);
    }
    return { leadId: item.leadId, subject, body, citedSignals };
  });
  if (new Set(drafts.map((draft) => draft.leadId)).size !== drafts.length) {
    throw new WorkspaceError('A lead can only appear once in a campaign.', 400);
  }
  return drafts;
}

function parseCampaignInput(body: Record<string, unknown>): {
  name: string;
  senderAccounts: string[];
  dailyLimit: number;
  drafts: ReviewedDraft[];
} {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) throw new WorkspaceError('Campaign name is required and must be 120 characters or fewer.', 400);

  if (!Array.isArray(body.senderAccounts) || body.senderAccounts.length < 1 || body.senderAccounts.length > 20) {
    throw new WorkspaceError('Choose between 1 and 20 valid dedicated Instantly sender mailboxes.', 400);
  }
  const senderAccounts = body.senderAccounts.map((value) => {
    if (typeof value !== 'string' || !EMAIL_PATTERN.test(value.trim())) {
      throw new WorkspaceError('Choose between 1 and 20 valid dedicated Instantly sender mailboxes.', 400);
    }
    return value.trim().toLowerCase();
  });
  const domains = new Set(instantlyAllowedSenderDomains());
  if (domains.size === 0) throw new WorkspaceError('Configure INSTANTLY_ALLOWED_SENDER_DOMAINS with valid dedicated campaign-mailbox domains before creating campaigns.', 503);
  const uniqueSenderAccounts = Array.from(new Set(senderAccounts));
  if (uniqueSenderAccounts.some((email) => {
    const domain = email.split('@').at(-1) ?? '';
    return PERSONAL_MAILBOX_DOMAINS.has(domain) || !domains.has(domain);
  })) {
    throw new WorkspaceError('Use only sender mailboxes on the dedicated domains configured for Instantly campaigns.', 403);
  }

  if (typeof body.dailyLimit !== 'number' || !Number.isInteger(body.dailyLimit) || body.dailyLimit < 1 || body.dailyLimit > 50) {
    throw new WorkspaceError('The daily campaign limit must be between 1 and 50.', 400);
  }

  return { name, senderAccounts: uniqueSenderAccounts, dailyLimit: body.dailyLimit, drafts: parseDrafts(body.drafts) };
}

function campaignFailureStatus(status: number | null): 'setup_failed' | 'creation_unknown' {
  return status === null || (status >= 200 && status < 300) ? 'creation_unknown' : 'setup_failed';
}

async function setCampaignState(
  db: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const { error } = await db.from('instantly_campaigns').update({ ...values, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) throw databaseError(error);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    requireTeamPermission(session.teamAccess, 'campaigns.view');
    const canViewLeads = hasTeamPermission(session.teamAccess, 'leads.view', 'assigned');
    const campaignResult = await db.from('instantly_campaigns')
        .select('id,name,status,daily_limit,sender_accounts,last_error,created_at,instantly_campaign_leads(count)')
        .order('created_at', { ascending: false }).limit(100);
    const leadResult = canViewLeads ? await db.from('leads').select('id,full_name,email,business,industry,status,account_id,form_payload')
        .is('archived_at', null).in('status', [...ACTIVE_LEAD_STATUSES])
        .order('created_at', { ascending: false }).limit(1000)
        .returns<Array<Pick<CampaignLead, 'id' | 'full_name' | 'email' | 'business' | 'industry' | 'status' | 'account_id' | 'form_payload'>>>()
      : { data: [], error: null };
    if (campaignResult.error) throw databaseError(campaignResult.error);
    if (leadResult.error) throw databaseError(leadResult.error);
    const addresses = (leadResult.data ?? []).map((lead) => lead.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email && EMAIL_PATTERN.test(email)));
    const blockedEmails = new Set<string>();
    if (addresses.length) {
      const [optOuts, suppressions] = await Promise.all([
        db.from('outreach_opt_outs').select('email').in('email', addresses),
        db.from('email_suppressions').select('email').in('email', addresses),
      ]);
      if (optOuts.error) throw databaseError(optOuts.error);
      if (suppressions.error) throw databaseError(suppressions.error);
      for (const row of [...(optOuts.data ?? []), ...(suppressions.data ?? [])]) blockedEmails.add(row.email.toLowerCase());
    }
    const eligibleLeads = (leadResult.data ?? []).filter((lead) => {
      const email = lead.email?.trim().toLowerCase() ?? '';
      return !lead.account_id && Boolean(lead.business || lead.industry) && EMAIL_PATTERN.test(email)
        && !leadDeclinedContact(lead.form_payload) && !blockedEmails.has(email);
    }).map(({ id, full_name, email, status, account_id, business, industry }) => ({
      id, full_name, email, status, account_id, company: business ?? industry,
    }));
    return NextResponse.json({
      campaigns: campaignResult.data ?? [],
      eligibleLeads,
      configuration: instantlyConfiguration(),
      senderDomains: instantlyAllowedSenderDomains(),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'instantly/campaigns'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  let campaignId: string | null = null;
  try {
    assertSameOriginJson(request);
    requireTeamPermission(session.teamAccess, 'campaigns.send');
    const body = await workspaceBody(request);
    if (!isRecord(body)) throw new WorkspaceError('Send campaign settings and reviewed drafts.', 400);
    const input = parseCampaignInput(body);
    const configuration = instantlyConfiguration();
    if (!configuration.ready) throw new WorkspaceError('Configure the Instantly API key, webhook secret, unsubscribe settings, and dedicated sender domains before creating campaigns.', 503);

    const postalAddress = process.env.EMAIL_POSTAL_ADDRESS?.trim() ?? '';
    const webOrigin = process.env.CRM_WEB_ORIGIN?.trim() ?? '';
    if (!postalAddress || !webOrigin) throw new WorkspaceError('Configure EMAIL_POSTAL_ADDRESS and CRM_WEB_ORIGIN before creating campaigns.', 503);
    let unsubscribeOrigin: URL;
    try { unsubscribeOrigin = new URL(webOrigin); }
    catch { throw new WorkspaceError('Configure a valid CRM_WEB_ORIGIN before creating campaigns.', 503); }
    if (unsubscribeOrigin.protocol !== 'https:' || unsubscribeOrigin.username || unsubscribeOrigin.password) {
      throw new WorkspaceError('Campaign unsubscribe links require a secure CRM_WEB_ORIGIN.', 503);
    }
    const webhookUrl = new URL('/api/instantly/webhook', unsubscribeOrigin).href;

    const ids = input.drafts.map((draft) => draft.leadId);
    const { data: leads, error: leadsError } = await db.from('leads')
      .select('id,full_name,email,phone,industry,business,website,account_id,archived_at,status,form_payload')
      .in('id', ids).returns<CampaignLead[]>();
    if (leadsError) throw databaseError(leadsError);
    if (leads?.length !== ids.length) throw new WorkspaceError('One or more selected leads no longer exist. Refresh and review the selection.', 409);

    const byId = new Map((leads ?? []).map((lead) => [lead.id, lead]));
    const emails = input.drafts.map((draft) => {
      const email = byId.get(draft.leadId)?.email?.trim().toLowerCase() ?? '';
      if (!EMAIL_PATTERN.test(email)) throw new WorkspaceError('Every selected lead must have a valid email address.', 409);
      return email;
    });
    const [optOuts, suppressions] = await Promise.all([
      db.from('outreach_opt_outs').select('email').in('email', emails),
      db.from('email_suppressions').select('email').in('email', emails),
    ]);
    if (optOuts.error) throw databaseError(optOuts.error);
    if (suppressions.error) throw databaseError(suppressions.error);
    const blockedEmails = new Set([...(optOuts.data ?? []), ...(suppressions.data ?? [])].map((row) => row.email.toLowerCase()));
    const invalid = input.drafts.find((draft) => {
      const lead = byId.get(draft.leadId);
      const email = lead?.email?.trim().toLowerCase() ?? '';
      return !lead || lead.archived_at || lead.account_id || !(lead.business || lead.industry) || ['won', 'lost'].includes(lead.status)
        || leadDeclinedContact(lead.form_payload) || blockedEmails.has(email);
    });
    if (invalid) {
      throw new WorkspaceError('A selected lead is archived, already a client, closed, opted out, suppressed, or has declined contact. Remove it and review the remaining selection.', 409);
    }

    const { data: created, error: insertError } = await db.from('instantly_campaigns').insert({
      created_by: session.user.id,
      name: input.name,
      status: 'creating',
      sender_accounts: input.senderAccounts,
      daily_limit: input.dailyLimit,
      steps: [{ type: 'email', delay: 0, delay_unit: 'days', personalized: true }],
    }).select('id').single<{ id: string }>();
    if (insertError) throw databaseError(insertError);
    campaignId = created.id;

    const leadRows = input.drafts.map((draft) => ({
      campaign_id: created.id,
      lead_id: draft.leadId,
      email: (byId.get(draft.leadId)?.email ?? '').trim().toLowerCase(),
      draft_subject: draft.subject,
      draft_body: draft.body,
      cited_signals: draft.citedSignals,
      status: 'pending',
    }));
    const { error: leadInsertError } = await db.from('instantly_campaign_leads').insert(leadRows);
    if (leadInsertError) {
      await setCampaignState(db, created.id, { status: 'setup_failed', last_error: 'Campaign leads could not be saved. No provider campaign was created.' });
      throw databaseError(leadInsertError);
    }

    const providerSteps: InstantlyCampaignInput['steps'] = [{ subject: '{{crm_personalized_subject}}', body: '{{crm_personalized_body}}', delay_days: 0 }];
    const providerInput: InstantlyCampaignInput = {
      name: input.name,
      senderAccounts: input.senderAccounts,
      dailyLimit: input.dailyLimit,
      steps: providerSteps,
    };

    let providerCampaignId: string;
    try {
      providerCampaignId = await createInstantlyCampaign(providerInput, postalAddress);
    } catch (error) {
      const state = campaignFailureStatus(error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : null);
      await setCampaignState(db, created.id, {
        status: state,
        last_error: error instanceof Error ? error.message : 'Instantly campaign creation could not be confirmed.',
      });
      const { error: leadStateError } = await db.from('instantly_campaign_leads').update({
        status: state === 'creation_unknown' ? 'acceptance_unknown' : 'failed',
        last_error: 'Campaign setup did not complete; check Instantly before retrying.',
      }).eq('campaign_id', created.id);
      if (leadStateError) throw databaseError(leadStateError);
      throw error;
    }

    const { error: providerIdError } = await db.from('instantly_campaigns')
      .update({ provider_campaign_id: providerCampaignId, updated_at: new Date().toISOString() }).eq('id', created.id);
    if (providerIdError) {
      await setCampaignState(db, created.id, { status: 'creation_unknown', last_error: 'Instantly created a campaign, but the CRM could not save its provider identity. Do not retry; contact the administrator.' });
      const { error: leadStateError } = await db.from('instantly_campaign_leads').update({
        status: 'acceptance_unknown',
        last_error: 'Instantly campaign creation was confirmed, but local provider identity was not saved. Do not retry.',
      }).eq('campaign_id', created.id);
      if (leadStateError) throw databaseError(leadStateError);
      throw databaseError(providerIdError);
    }

    let webhookId: string;
    try {
      webhookId = await createInstantlyWebhook(providerCampaignId, webhookUrl);
    } catch (error) {
      const state = campaignFailureStatus(error instanceof Error && 'status' in error && typeof error.status === 'number' ? error.status : null);
      await setCampaignState(db, created.id, {
        status: state,
        last_error: error instanceof Error ? error.message : 'Instantly webhook setup failed.',
      });
      const { error: leadStateError } = await db.from('instantly_campaign_leads').update({
        status: state === 'creation_unknown' ? 'acceptance_unknown' : 'failed',
        last_error: 'Webhook setup did not complete; campaign remains paused. Check Instantly before retrying.',
      }).eq('campaign_id', created.id);
      if (leadStateError) throw databaseError(leadStateError);
      throw error;
    }
    await setCampaignState(db, created.id, { provider_webhook_id: webhookId });

    const providerLeads: InstantlyLeadInput[] = input.drafts.map((draft) => {
      const lead = byId.get(draft.leadId);
      const nameParts = (lead?.full_name ?? '').trim().split(/\s+/);
      const url = new URL('/api/email/unsubscribe', unsubscribeOrigin);
      url.searchParams.set('token', unsubscribeToken(lead?.email ?? ''));
      return {
        email: (lead?.email ?? '').trim().toLowerCase(),
        firstName: nameParts[0] ?? '',
        lastName: nameParts.slice(1).join(' '),
        companyName: lead?.business ?? lead?.industry ?? null,
        phone: lead?.phone ?? null,
        website: lead?.website ?? null,
        personalizedSubject: draft.subject,
        personalizedBody: draft.body,
        unsubscribeUrl: url.href,
      };
    });
    try {
      await addInstantlyLeads(providerCampaignId, providerLeads);
    } catch (error) {
      const providerStatus = error instanceof Error && 'status' in error && typeof error.status === 'number'
        ? error.status : null;
      const unknown = campaignFailureStatus(providerStatus) === 'creation_unknown';
      await setCampaignState(db, created.id, {
        status: unknown ? 'creation_unknown' : 'setup_failed',
        last_error: error instanceof Error ? error.message : 'Instantly lead import failed.',
      });
      const { error: leadStateError } = await db.from('instantly_campaign_leads').update({
        status: unknown ? 'acceptance_unknown' : 'failed',
        last_error: error instanceof Error ? error.message : 'Instantly lead import failed.',
      }).eq('campaign_id', created.id);
      if (leadStateError) throw databaseError(leadStateError);
      throw error;
    }

    const { error: readyError } = await db.from('instantly_campaign_leads')
      .update({ status: 'synced', updated_at: new Date().toISOString() }).eq('campaign_id', created.id);
    if (readyError) {
      try {
        await setCampaignState(db, created.id, { status: 'creation_unknown', last_error: 'Instantly accepted the leads, but the CRM could not record that state. Do not retry.' });
      } catch (stateError) {
        console.error('[instantly/campaign-ready-state]', stateError);
      }
      throw databaseError(readyError);
    }
    await setCampaignState(db, created.id, { status: 'ready', last_error: null });
    return NextResponse.json({
      campaign: { id: created.id, status: 'ready' },
      message: 'Campaign is staged in Instantly and remains paused. Review the provider setup, then explicitly activate it.',
    }, { status: 201 });
  } catch (error) {
    if (campaignId) {
      const { data: state, error: stateError } = await db.from('instantly_campaigns').select('status').eq('id', campaignId).maybeSingle<{ status: string }>();
      if (stateError) console.error('[instantly/campaign-create-state]', stateError);
      if (!state?.status || state.status === 'creating') {
        const { error: stateUpdateError } = await db.from('instantly_campaigns')
          .update({ status: 'setup_failed', last_error: 'Campaign setup did not complete.' }).eq('id', campaignId).eq('status', 'creating');
        if (stateUpdateError) console.error('[instantly/campaign-create-state-update]', stateUpdateError);
      }
    }
    return workspaceApiError(error, 'instantly/campaign-create');
  }
}
