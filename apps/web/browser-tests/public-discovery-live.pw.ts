import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { EMPTY_OPPORTUNITY_PROFILE, type DiscoveryCandidate, type OpportunityProfileRecord, type PublicDiscoveryPage } from '@crm/shared';
import { test, expect } from './workspace-fixtures';

test('real FMCSA discovery retains provenance and enforces reviewed, contact-aware promotion without outreach', async ({ context, authCookies, settingsOwner: _owner }) => {
  test.skip(process.env.CRM_FMCSA_QA_ALLOWED !== '1', 'Requires explicit authorization for live FMCSA retrieval and disposable CRM storage.');
  test.setTimeout(120000);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !anon) throw new Error('Configured private CRM access is required.');
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const auth = createServerClient(url, anon, { cookies: { getAll: () => authCookies, setAll: () => {} } });
  const identity = await auth.auth.getUser();
  const actor = identity.data.user;
  if (identity.error || actor?.user_metadata.crm_browser_qa !== true) throw new Error('A disposable pilot identity is required.');
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
  let source: string | null = null, batch: string | null = null, lead: string | null = null;
  const request = randomUUID(), task = randomUUID();
  try {
    const approved = await context.request.post('/api/intelligence/sources', { data: { config: {
      name: `Disposable FMCSA pilot ${request}`, provider: 'fmcsa',
      permission_reference: 'Owner explicitly authorized FMCSA QCMobile retrieval and temporary retained CRM use for this disposable pilot. Remove all pilot records and this approval afterward. https://mobile.fmcsa.dot.gov/QCDevsite/docs/qcApi',
      acquisition_until: new Date(Date.now() + 86400000).toISOString().slice(0, 10), retained_crm_rights: true,
    } } });
    expect(approved.status()).toBe(200);
    source = (await approved.json()).id;
    expect(source).toMatch(/^[a-f0-9-]{36}$/);
    const query = process.env.CRM_FMCSA_QA_QUERY || 'Greyhound';
    const searched = await context.request.get(`/api/intelligence/public-records?${new URLSearchParams({ source_id: source!, query, start: '0' })}`);
    expect(searched.status(), searched.status() === 200 ? undefined : await searched.text()).toBe(200);
    const found = await searched.json() as PublicDiscoveryPage;
    expect(found.businesses.length).toBeGreaterThan(0);
    const business = found.businesses.find((item) => item.phone) ?? found.businesses[0];
    const acquire = () => context.request.post('/api/intelligence/public-records', { data: { source_id: source, request_id: request, dot_number: business.dot_number } });
    const acquired = await acquire();
    expect(acquired.status(), acquired.status() === 201 ? undefined : await acquired.text()).toBe(201);
    batch = (await acquired.json()).batch_id;
    const retried = await acquire();
    expect(retried.status()).toBe(200);
    expect(await retried.json()).toMatchObject({ batch_id: batch, already_acquired: true, prospect_count: 1 });
    const candidates = await context.request.get(`/api/intelligence/candidates?source_id=${source}`);
    expect(candidates.status()).toBe(200);
    const candidate: DiscoveryCandidate = (await candidates.json()).candidates[0];
    expect(candidate).toMatchObject({ batch_id: batch, email: null });
    expect(candidate.discovery_review).toBe(candidate.phone && !candidate.duplicate_of ? 'discovered' : 'needs_verification');
    expect(candidate.profile).toMatchObject({ public_source: { provider: 'fmcsa', record_id: business.dot_number } });
    expect(candidate.profile.company).not.toHaveProperty('employees');
    expect(candidate.profile).not.toHaveProperty('renewals');
    const promote = () => context.request.post(`/api/import/${batch}/commit`, { data: { include_ids: [candidate.id] } });
    expect(await (await promote()).json()).toMatchObject({ committed: 0 });
    const reviewed = await context.request.patch('/api/intelligence/candidates', { data: { id: candidate.id,
      expected_updated_at: candidate.discovery_updated_at, review: 'reviewed',
      note: 'Disposable technical review of the selected public DOT identity only; insurance and contact permission remain unknown.',
    } });
    expect(reviewed.status()).toBe(200);
    const promoted = await promote();
    expect(promoted.status()).toBe(200);
    const promotion = await promoted.json();
    if (!candidate.phone) {
      expect(promotion).toMatchObject({ committed: 0, blocked_no_contact: 1 });
      console.info('Live FMCSA pilot:', { matches: found.businesses.length, search_results_with_phone: found.businesses.filter((item) => item.phone).length,
        staged: 1, retained_for_research: true, promoted: 0 });
      return;
    }
    expect(promotion).toMatchObject({ committed: 1, failed: 0 });
    lead = promotion.results[0].lead_id;
    expect(await (await promote()).json()).toMatchObject({ committed: 0, already_committed: 1 });
    const persisted = await admin.from('leads').select('form_payload').eq('id', lead!).single();
    if (persisted.error) throw new Error('Pilot lead provenance could not be verified.');
    expect(persisted.data.form_payload.import.discovery_source_id).toBe(source);
    const endpoint = `/api/intelligence/opportunities?type=lead&id=${lead}`;
    const workspaceReply = await context.request.get(endpoint);
    expect(workspaceReply.status()).toBe(200);
    const workspace = await workspaceReply.json() as { profile: OpportunityProfileRecord; evidence_token: string };
    const saved = await context.request.post('/api/intelligence/opportunities', { data: {
      type: 'lead', id: lead, action: 'profile', scope_key: workspace.profile.scope_key, revision: workspace.profile.revision,
      profile: { ...EMPTY_OPPORTUNITY_PROFILE, facts: { industry: 'DOT-registered motor carrier', state: business.state ?? '' },
        source_reference: `Disposable technical identity review: FMCSA DOT ${business.dot_number}. Insurance, contact route and permission remain unknown.`,
        confirmed_on: new Date().toISOString().slice(0, 10) },
    } });
    expect(saved.status(), saved.status() === 200 ? undefined : await saved.text()).toBe(200);
    const refreshed = await context.request.get(endpoint);
    expect(refreshed.status()).toBe(200);
    const current = await refreshed.json() as { profile: OpportunityProfileRecord; evidence_token: string };
    expect(current.profile.profile).toMatchObject({ contactability: 'unknown', permission: 'unknown' });
    const taskPayload = { type: 'lead', id: lead, action: 'task', evidence_token: current.evidence_token, task_id: task,
      assignee: actor.id, due_at: new Date(Date.now() + 86400000).toISOString() };
    const assigned = await context.request.post('/api/intelligence/opportunities', { data: taskPayload });
    expect(assigned.status(), assigned.status() === 200 ? undefined : await assigned.text()).toBe(200);
    const assignedTask = await assigned.json();
    expect(assignedTask.id).toBe(task);
    expect((await context.request.post('/api/intelligence/opportunities', { data: taskPayload })).status()).toBe(200);
    const page = await context.newPage();
    await page.route('**/api/**', (route) => route.continue());
    await page.goto(assignedTask.action_href);
    await expect(page).toHaveURL(`/leads?lead=${lead}&tab=overview&intelligence=1`);
    const actions = page.getByRole('region', { name: 'Market fit and actions' });
    await expect(actions.getByRole('heading', { name: business.legal_name, exact: true })).toBeVisible();
    await actions.getByText('Draft an individual follow-up', { exact: true }).click();
    await expect(actions.getByRole('button', { name: 'Send reviewed email', exact: true })).toBeDisabled();
    await page.close();
    for (const table of ['sequence_enrollments', 'outreach_outbox']) {
      const rows = await admin.from(table).select('id').eq('lead_id', lead!);
      if (rows.error) throw new Error('Pilot no-outreach check failed.');
      expect(rows.data).toHaveLength(0);
    }
    console.info('Live FMCSA pilot:', { matches: found.businesses.length, staged: 1, promoted: 1, inline_task_verified: true, enrolled_or_sent: 0 });
  } finally {
    try {
      await prisma.$transaction(async (tx) => {
        if (lead) {
          const scope = `lead:${lead}`;
          await tx.$executeRawUnsafe("delete from notifications where task_id in (select id from tasks where related_type='lead' and related_id=$1::uuid)", lead);
          await tx.$executeRawUnsafe("delete from tasks where related_type='lead' and related_id=$1::uuid", lead);
          await tx.$executeRawUnsafe('delete from opportunity_action_events where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from opportunity_profile_history where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from opportunity_profiles where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from intelligence_dossiers where scope_key=$1', scope);
          await tx.$executeRawUnsafe('delete from leads where id=$1::uuid', lead);
        }
        if (batch) await tx.$executeRawUnsafe('delete from import_batches where id=$1::uuid', batch);
        if (source) await tx.$executeRawUnsafe('delete from discovery_sources where id=$1::uuid', source);
        await tx.$executeRawUnsafe('delete from agency_audit where actor_id=$1::uuid', actor.id);
      }, { timeout: 15000 });
    } finally { await prisma.$disconnect(); }
  }
});
