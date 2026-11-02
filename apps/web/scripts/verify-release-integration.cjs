const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..', '..', '..');
require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
const { createClient } = require('@supabase/supabase-js');
const { createServerClient } = require('@supabase/ssr');
if (process.env.CRM_RELEASE_QA_ALLOWED !== '1') throw new Error('Set CRM_RELEASE_QA_ALLOWED=1 to create and remove isolated release-verification records. No customer records are modified.');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const account = randomUUID(), requestId = randomUUID(), qaLead = randomUUID(), qaClaim = randomUUID(), qaOutbox = randomUUID(), qaQuote = randomUUID(), qaQuoteIssue = randomUUID(), qaInsuredAsset = randomUUID(), qaScheduledPolicyRequest = randomUUID();
const email = `release-qa-${randomUUID()}@example.invalid`, password = `${randomUUID()}${randomUUID()}`;
let userId, storagePath, fileId, policyId;

async function checked(result, operation) { if (result.error) throw new Error(`${operation}: ${result.error.message}`); return result.data; }
async function session() {
  const cookies = [];
  const auth = createServerClient(url, anon, { cookies: {
    getAll: () => cookies,
    setAll: (values) => { for (const value of values) { const i = cookies.findIndex((cookie) => cookie.name === value.name); if (i >= 0) cookies.splice(i, 1); cookies.push(value); } },
  } });
  await checked(await auth.auth.signInWithPassword({ email, password }), 'QA sign-in');
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
}
async function api(cookie, route, init) {
  const response = await fetch(`${base}${route}`, { ...init, headers: { Cookie: cookie, 'Content-Type': 'application/json', ...init?.headers }, redirect: 'manual' });
  if (!response.ok) throw new Error(`QA API ${route.split('?')[0]} returned ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return response;
}
async function main() {
  const cleanupFailures = [];
  try {
    const created = await checked(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: 'Disposable release verification', crm_browser_qa: true } }), 'QA auth creation');
    userId = created.user.id;
    await checked(await admin.from('clients').insert({ id: account, full_name: 'CRM RELEASE QA - disposable', source: 'release-verification' }), 'QA account creation');
    const first = await session();
    const bytes = Buffer.from('%PDF-1.4\n% CRM release byte verification\n\0\x7f\xff\n%%EOF', 'latin1');
    const payload = { file_name: 'Release-verification.pdf', content_type: 'application/pdf', file_size: bytes.length };
    const ticket = await (await api(first, `/api/clients/${account}/files/upload`, { method: 'POST', body: JSON.stringify(payload) })).json();
    storagePath = ticket.upload.storage_path;
    await checked(await admin.storage.from('account-documents').uploadToSignedUrl(storagePath, ticket.upload.token, bytes, { contentType: 'application/pdf' }), 'Signed private upload');
    const confirmation = { ...payload, storage_path: storagePath };
    const saved = await (await api(first, `/api/clients/${account}/files/upload/complete`, { method: 'POST', body: JSON.stringify(confirmation) })).json();
    fileId = saved.id;
    const retry = await (await api(first, `/api/clients/${account}/files/upload/complete`, { method: 'POST', body: JSON.stringify(confirmation) })).json();
    assert.equal(retry.id, fileId);
    const second = await session();
    const coreWorkspace = await (await api(second, `/api/clients/${account}/workspace?mode=core`)).json();
    assert.equal(coreWorkspace.client.id, account);
    assert.deepEqual(coreWorkspace.omitted_sections, ['communications', 'timelineTasks', 'files']);
    assert.deepEqual(coreWorkspace.communications, []);
    assert.deepEqual(coreWorkspace.timelineTasks, []);
    assert.deepEqual(coreWorkspace.files, []);
    console.log('PASS lightweight initial account workspace contract; duplicate history/file/task reads explicitly omitted.');
    const refreshed = await (await api(second, `/api/clients/${account}/files`)).json();
    assert.ok(refreshed.some((file) => file.id === fileId && file.source_kind === 'stored'));
    const downloaded = await api(second, saved.download_url);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    const unauthorized = await fetch(`${base}${saved.download_url}`, { redirect: 'manual' });
    assert.equal(unauthorized.status, 401);
    const publicFile = await createClient(url, anon).storage.from('account-documents').download(storagePath);
    assert.ok(publicFile.error, 'Anonymous storage access must fail.');
    console.log('PASS real signed upload, confirmation retry, refresh and exact-byte private download from a second session; anonymous access denied.');

    const receipt = { p_event_key: `release-qa:${requestId}`, p_client_id: account, p_lead_id: null,
      p_channel: 'email', p_from: email, p_to: 'qa@example.invalid', p_subject: 'Disposable inbound concurrency verification',
      p_body: 'QA receipt only; no provider delivery.', p_sent_at: new Date().toISOString(), p_provider_id: requestId };
    const receipts = await Promise.all([0, 1, 2].map(() => admin.rpc('ingest_inbound_message', receipt)));
    for (const result of receipts) await checked(result, 'Concurrent inbound receipt');
    assert.ok(receipts.every((result) => result.data.id === receipts[0].data.id));
    const logId = receipts[0].data.id;
    const replies = await Promise.all([0, 1].map(() => admin.rpc('process_outreach_reply', {
      p_client_id: account, p_email: email, p_phone: null, p_body: receipt.p_body, p_log_id: logId,
    })));
    for (const result of replies) await checked(result, 'Concurrent reply checkpoint');
    const alerts = await Promise.all([0, 1, 2].map(() => admin.rpc('alert_inbound_message', { p_log_id: logId, p_skip_task: false })));
    for (const result of alerts) await checked(result, 'Concurrent inbound alerts');
    const [replyTasks, notifications, logs] = await Promise.all([
      admin.from('tasks').select('id').eq('inbound_reply_key', `client:${account}`),
      admin.from('notifications').select('id').eq('message_log_id', logId),
      admin.from('communication_log').select('id').eq('inbound_event_key', receipt.p_event_key),
    ]);
    assert.equal((await checked(replyTasks, 'QA reply tasks')).length, 1);
    assert.equal((await checked(notifications, 'QA reply notifications')).length, 1);
    assert.equal((await checked(logs, 'QA receipt count')).length, 1);
    console.log('PASS overlapping inbound receipts, reply checkpoints and alerts: one message, one notification and one reply task.');
    await checked(await admin.from('communication_log').insert({
      client_id: account, channel: 'email', direction: 'outbound', sent_at: new Date(Date.now() + 1000).toISOString(),
      metadata: { delivery_status: 'accepted_by_provider', release_qa: true, to: email },
    }), 'QA-only outgoing log; no provider call');
    const resolvedReplies = await checked(await admin.from('tasks').select('id,status').eq('inbound_reply_key', `client:${account}`), 'Resolved QA reply task');
    assert.equal(resolvedReplies.length, 1);
    assert.equal(resolvedReplies[0].status, 'completed');
    console.log('PASS source-resolved reply updates the ordinary task automatically; no email was sent.');

    const fields = { insured_name: 'CRM RELEASE QA - disposable', carrier: 'QA carrier', line_of_business: 'Auto', policy_number: `QA-${requestId}`,
      premium: 100, effective_date: '2026-11-02', expiration_date: '2027-11-02', renewal_date: '2027-11-02', status: 'issued' };
    const issued = await Promise.all([0, 1].map(() => admin.rpc('issue_policy_atomic', { p_request_id: requestId, p_account_id: account, p_lead_id: null, p_policy: fields })));
    for (const result of issued) await checked(result, 'Concurrent policy issuance');
    policyId = issued[0].data.policy.id;
    assert.equal(issued[1].data.policy.id, policyId);
    assert.equal(issued.filter((result) => result.data.created).length, 1);
    await checked(await admin.from('client_assets').insert({ id: qaInsuredAsset, client_id: account,
      title: 'Disposable scheduled vehicle', asset_type: 'vehicle', metadata: { details: { vin: 'QA-SCHEDULE-ONLY' } } }), 'QA insured asset');
    const scheduledPolicy = { ...fields, account_id: account, client_id: account, policy_number: `QA-SCHEDULE-${qaInsuredAsset}`,
      request_id: qaScheduledPolicyRequest, carrier_confirmed: true, email_consent: false, insured_asset_ids: [qaInsuredAsset] };
    const scheduledFirst = await (await api(first, '/api/policies', { method: 'POST', body: JSON.stringify(scheduledPolicy) })).json();
    const scheduledRetry = await (await api(second, '/api/policies', { method: 'POST', body: JSON.stringify(scheduledPolicy) })).json();
    assert.equal(scheduledFirst.id, scheduledRetry.id);
    const scheduleRows = await checked(await admin.from('policy_insured_assets').select('asset_id,snapshot').eq('policy_id', scheduledFirst.id), 'QA insured asset schedule');
    assert.equal(scheduleRows.length, 1);
    assert.equal(scheduleRows[0].asset_id, qaInsuredAsset);
    assert.equal(scheduleRows[0].snapshot.title, 'Disposable scheduled vehicle');
    await checked(await admin.from('client_assets').update({ title: 'Changed after issuance' }).eq('id', qaInsuredAsset), 'Edit QA account inventory after placement');
    const retainedSchedule = await checked(await admin.from('policy_insured_assets').select('snapshot').eq('policy_id', scheduledFirst.id).single(), 'Retained policy schedule snapshot');
    assert.equal(retainedSchedule.snapshot.title, 'Disposable scheduled vehicle');
    console.log('PASS explicit insured-asset schedule, safe issuance retry, and placement-time snapshot unchanged by later inventory edits.');
    const renewalPrefill = await (await api(second, `/api/policies/prefill?account_id=${account}&renew_from_id=${policyId}`)).json();
    assert.equal(renewalPrefill.prior_policy_id, policyId);
    assert.equal(renewalPrefill.prior_policy_number, fields.policy_number);
    assert.equal(renewalPrefill.carrier, fields.carrier);
    assert.equal(renewalPrefill.effective_date, undefined);
    assert.equal(renewalPrefill.policy_number, undefined);
    console.log('PASS renewal handoff reuses verified prior account term without copying its policy number or term dates.');
    const task = { subject: 'QA renewal review', description: 'Disposable concurrency verification', due_date: '2027-10-02T16:00:00Z', priority: 'medium' };
    const renewals = await Promise.all([0, 1].map(() => admin.rpc('persist_renewal_radar', { p_policy_id: policyId, p_renewal_date: '2027-11-02', p_milestone: 45, p_task: task, p_message: 'Disposable QA renewal' })));
    for (const result of renewals) await checked(result, 'Concurrent renewal processing');
    const tasks = await checked(await admin.from('tasks').select('id').eq('renewal_policy_id', policyId).eq('renewal_canonical', true), 'QA renewal count');
    assert.equal(tasks.length, 1);
    console.log('PASS separate-connection overlapping policy issuance and renewal processing: one policy, one canonical renewal task.');

    await checked(await admin.from('claims').insert({ id: qaClaim, client_id: account, policy_id: policyId, type: 'Disposable QA claim', date_of_loss: '2026-11-02' }), 'QA service source');
    const sourceKey = `service:claim:${qaClaim}`;
    const serviceTasks = await checked(await admin.from('tasks').select('id,updated_at,action_href').eq('automation_key', sourceKey), 'Immediate service task');
    assert.equal(serviceTasks.length, 1);
    assert.ok(serviceTasks[0].action_href.includes(`context_id=${qaClaim}`));
    const updates = await Promise.all([0, 1].map(() => admin.rpc('sync_service_action', { p_kind: 'claim', p_id: qaClaim })));
    for (const result of updates) await checked(result, 'Overlapping service reconciliation');
    assert.equal((await checked(await admin.from('notifications').select('id').eq('task_id', serviceTasks[0].id), 'Service notifications')).length, 1);
    const otherSessionTasks = await (await api(second, `/api/tasks?record_type=client&record_id=${account}&status=open&include=related&limit=200`)).json();
    assert.equal(otherSessionTasks.filter((task) => task.id === serviceTasks[0].id).length, 1);
    await checked(await admin.from('claims').update({ status: 'closed' }).eq('id', qaClaim), 'Resolve QA service');
    assert.equal((await checked(await admin.from('tasks').select('status').eq('id', serviceTasks[0].id).single(), 'Resolved service task')).status, 'completed');
    await checked(await admin.from('leads').insert({ id: qaLead, account_id: account, full_name: 'Disposable automation QA', email, status: 'new' }), 'QA outreach lead');
    const placement = await (await api(second, `/api/policies/prefill?account_id=${account}&lead_id=${qaLead}`)).json();
    assert.equal(placement.account_id, account);
    assert.equal(placement.lead_id, qaLead);
    assert.equal(placement.insured_name, 'Disposable automation QA');
    assert.equal(placement.email, email);
    assert.equal(placement.premium, undefined);
    assert.equal(placement.carrier, undefined);
    const accountPlacement = await (await api(second, `/api/policies/prefill?account_id=${account}`)).json();
    assert.equal(accountPlacement.lead_id, null);
    const unconfirmed = await fetch(`${base}/api/policies`, { method: 'POST', headers: { Cookie: second, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, account_id: account, lead_id: qaLead, carrier_confirmed: false }), redirect: 'manual' });
    assert.equal(unconfirmed.status, 400);
    assert.equal((await checked(await admin.from('leads').select('status').eq('id', qaLead).single(), 'Unconfirmed QA lead unchanged')).status, 'new');
    assert.equal((await checked(await admin.from('policies').select('id').eq('client_id', account), 'Unconfirmed QA policy count')).length, 1);
    console.log('PASS authenticated exact lead/account placement prefill and confirmation-required API rejection without policy or lead changes.');
    const quoteRoute = `/api/quote-options?record_type=lead&record_id=${qaLead}`;
    const quoteFields = { id: qaQuote, carrier: 'Manual QA carrier', line_of_business: 'Auto', premium: '1250.55',
      effective_date: '2026-11-02', expiration_date: '2027-11-02', limits: 'QA limits', deductibles: 'QA deductible', notes: 'Never submitted to a carrier.', status: 'draft' };
    const quote = await (await api(first, quoteRoute, { method: 'POST', body: JSON.stringify(quoteFields) })).json();
    const retryQuote = await (await api(second, quoteRoute, { method: 'POST', body: JSON.stringify(quoteFields) })).json();
    assert.equal(quote.id, retryQuote.id);
    const accountQuotes = await (await api(second, `/api/quote-options?record_type=client&record_id=${account}`)).json();
    assert.ok(accountQuotes.some((item) => item.id === qaQuote));
    const acceptedQuote = await (await api(second, quoteRoute, { method: 'PATCH',
      body: JSON.stringify({ ...quoteFields, status: 'accepted', expected_updated_at: quote.updated_at }) })).json();
    assert.equal(acceptedQuote.status, 'accepted');
    const staleQuote = await fetch(`${base}${quoteRoute}`, { method: 'PATCH', headers: { Cookie: first, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...quoteFields, status: 'declined', expected_updated_at: quote.updated_at }), redirect: 'manual' });
    assert.equal(staleQuote.status, 409);
    assert.equal((await checked(await admin.from('quote_option_history').select('id').eq('quote_id', qaQuote), 'Quote history')).length, 2);
    const historyRoute = `/api/quote-options?record_type=client&record_id=${account}&history_quote_id=${qaQuote}`;
    const history = await (await api(second, historyRoute)).json();
    assert.equal(history.length, 2);
    assert.equal(typeof history[0].id, 'string');
    assert.equal(history[0].snapshot.status, 'accepted');
    assert.equal(history[1].snapshot.status, 'draft');
    assert.equal(history[1].snapshot.notes, quoteFields.notes);
    const older = await (await api(first, `${historyRoute}&before_id=${history[0].id}`)).json();
    assert.deepEqual(older.map((entry) => entry.id), [history[1].id]);
    const leadHistory = await (await api(first, `${quoteRoute}&history_quote_id=${qaQuote}`)).json();
    assert.deepEqual(leadHistory, history);
    const wrongQuote = await fetch(`${base}${historyRoute.replace(qaQuote, randomUUID())}`, { headers: { Cookie: second }, redirect: 'manual' });
    assert.equal(wrongQuote.status, 404);
    const unauthenticatedHistory = await fetch(`${base}${historyRoute}`, { redirect: 'manual' });
    assert.equal(unauthenticatedHistory.status, 401);
    console.log('PASS account/lead quote history, preserved revisions, lossless cursor and authenticated selected-quote access.');
    assert.equal((await checked(await admin.from('leads').select('status').eq('id', qaLead).single(), 'Accepted quote lead unchanged')).status, 'new');
    assert.equal((await checked(await admin.from('policies').select('id').eq('client_id', account), 'Accepted quote policy count')).length, 1);
    console.log('PASS saved manual quote retry, cross-session account visibility, accepted outcome history and stale-version conflict; no coverage or lead completion.');
    const quotePrefill = await (await api(second, `/api/policies/prefill?account_id=${account}&lead_id=${qaLead}&quote_id=${qaQuote}`)).json();
    assert.equal(quotePrefill.carrier, 'Manual QA carrier');
    assert.equal(Number(quotePrefill.premium), 1250.55);
    const confirmedQuote = { ...fields, account_id: account, lead_id: qaLead, request_id: qaQuoteIssue,
      carrier: quotePrefill.carrier, premium: quotePrefill.premium, policy_number: `QA-QUOTE-${qaQuote}`,
      quote_id: qaQuote, quote_version: quotePrefill.quote_version, carrier_confirmed: true, email_consent: false };
    const placements = await Promise.all([first, second].map(async (cookie) =>
      (await api(cookie, '/api/policies', { method: 'POST', body: JSON.stringify(confirmedQuote) })).json()));
    assert.equal(placements[0].id, placements[1].id);
    assert.equal(placements[0].quote_option_id, qaQuote);
    assert.equal(placements[0].quote_snapshot.carrier, 'Manual QA carrier');
    assert.equal((await checked(await admin.from('leads').select('status').eq('id', qaLead).single(), 'Confirmed quote lead')).status, 'won');
    await checked(await admin.from('quote_options').update({ carrier: 'Later QA quote revision', updated_at: new Date().toISOString() }).eq('id', qaQuote), 'Later quote edit');
    const placedRetry = await (await api(second, '/api/policies', { method: 'POST', body: JSON.stringify(confirmedQuote) })).json();
    assert.equal(placedRetry.id, placements[0].id);
    assert.equal(placedRetry.quote_snapshot.carrier, 'Manual QA carrier');
    console.log('PASS exact quote prefill and overlapping confirmed placement: one linked policy, preserved quote snapshot and retry after later quote edit; no provider send.');
    await checked(await admin.from('outreach_outbox').insert({ id: qaOutbox, lead_id: qaLead, to_email: email, subject: 'Disposable approval verification', body: 'Never sent.' }), 'QA draft source');
    const approval = await checked(await admin.from('tasks').select('id,status,action_href').eq('automation_key', `outreach:${qaOutbox}`).single(), 'Immediate approval task');
    assert.equal(approval.status, 'open');
    assert.ok(approval.action_href.includes(qaOutbox));
    await checked(await admin.from('outreach_outbox').update({ status: 'rejected' }).eq('id', qaOutbox), 'Reject QA draft without sending');
    assert.equal((await checked(await admin.from('tasks').select('status').eq('id', approval.id).single(), 'Resolved approval task')).status, 'completed');
    console.log('PASS immediate service/outreach task and notification wiring, duplicate prevention across overlapping calls, cross-session task visibility and source-driven completion.');

    for (const route of ['/api/tasks?status=open&count=true', '/api/workday', '/api/automation/health', '/api/communication/inbox',
      `/api/clients/${account}/context?type=policy&id=${policyId}`, `/api/communication-log?client_id=${account}`]) {
      await api(second, route);
    }
    console.log('PASS authenticated live Workday, health, Inbox and canonical account thread contracts.');
  } finally {
    const cleanup = async (label, action) => { try { await checked(await action(), label); } catch { cleanupFailures.push(label); } };
    if (storagePath) await cleanup('private QA bytes', () => admin.storage.from('account-documents').remove([storagePath]));
    await cleanup('QA document records', () => admin.from('client_files').delete().eq('client_id', account));
    await cleanup('QA issue operation', () => admin.from('policy_issue_operations').delete().eq('request_id', requestId));
    await cleanup('QA quote issue operation', () => admin.from('policy_issue_operations').delete().eq('request_id', qaQuoteIssue));
    await cleanup('QA notifications', () => admin.from('notifications').delete().eq('client_id', account));
    await cleanup('QA outreach draft', () => admin.from('outreach_outbox').delete().eq('id', qaOutbox));
    await cleanup('QA messages', () => admin.from('communication_log').delete().eq('client_id', account));
    await cleanup('QA tasks', () => admin.from('tasks').delete().eq('account_id', account));
    await cleanup('QA policies', () => admin.from('policies').delete().eq('client_id', account));
    await cleanup('QA scheduled asset', () => admin.from('client_assets').delete().eq('id', qaInsuredAsset));
    await cleanup('QA quote history', () => admin.from('quote_option_history').delete().eq('quote_id', qaQuote));
    await cleanup('QA quote option', () => admin.from('quote_options').delete().eq('id', qaQuote));
    await cleanup('QA automation lead', () => admin.from('leads').delete().eq('id', qaLead));
    await cleanup('QA account', () => admin.from('clients').delete().eq('id', account));
    if (userId) await cleanup('QA auth user', () => admin.auth.admin.deleteUser(userId));
    if (cleanupFailures.length) throw new Error(`QA cleanup failed: ${cleanupFailures.join(', ')}. Disposable account: ${account}; auth user: ${userId ?? 'not created'}. Inspect only these fixture identifiers.`);
    console.log('Disposable release records, private bytes and auth user removed. No customer record was edited; no email or SMS was sent.');
  }
}
void main().catch((error) => { console.error(error.message); process.exitCode = 1; });
