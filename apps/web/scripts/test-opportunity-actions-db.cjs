const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
if (process.argv.includes('--use-local')) require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
const url = process.argv.includes('--use-local') ? process.env.DIRECT_URL || process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL or explicitly use --use-local; all changes roll back.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('OPPORTUNITY_ROLLBACK_VERIFIED');
async function expected(tx, work, code) {
  await tx.$executeRawUnsafe('SAVEPOINT expected_failure');
  let failure; try { await work(); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_failure');
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_failure');
  assert.ok(failure, `Expected ${code}`); assert.equal(failure.meta?.code, code, failure.message);
}
async function main() {
  try {
    await db.$transaction(async (tx) => {
      for (const [table, name] of [['carrier_appetite_documents', '20261111010000_carrier_appetite.sql'], ['opportunity_profiles', '20261111020000_opportunity_actions.sql'], ['opportunity_settings', '20261111030000_opportunity_operations.sql']]) {
        const installed = await tx.$queryRawUnsafe(`select to_regclass('public.${table}')::text as name`);
        if (!installed[0].name) {
          const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', name), 'utf8').replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
          await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${sql}$migration$; END $verify$;`);
        }
      }
      const owners = await tx.$queryRawUnsafe("select user_id from agency_members where active and role='owner' limit 1");
      assert.equal(owners.length, 1);
      const actor = owners[0].user_id, lead = randomUUID(), outsider = randomUUID(), agent = randomUUID();
      await tx.$executeRawUnsafe('insert into auth.users(id,email) values($1::uuid,$2)', agent, `opportunity-${agent}@example.test`);
      await tx.$executeRawUnsafe("insert into agency_members(user_id,email,role,active) values($1::uuid,$2,'agent',true)", agent, `opportunity-${agent}@example.test`);
      await tx.$executeRawUnsafe("insert into leads(id,full_name,email,source,status,agent_user_id) values($1::uuid,'Synthetic OIP business','qa@example.test','prospect_import','new',$2::uuid)", lead, actor);
      const context = async (user = actor, id = lead) => (await tx.$queryRawUnsafe('select get_opportunity_context($1::uuid,\'lead\',$2::uuid) as value', user, id))[0].value;
      const save = async (revision, profile) => (await tx.$queryRawUnsafe('select save_opportunity_profile($1::uuid,\'lead\',$2::uuid,$3,$4::integer,$5::jsonb) as value',
        actor, lead, `lead:${lead}`, revision, JSON.stringify(profile)))[0].value;
      await expected(tx, () => context(outsider), '42501');
      await expected(tx, () => context(agent), '42501');
      let before = await context();
      assert.equal(before.profile.revision, 0);
      const profile = { facts: { state: 'AZ', line: 'General liability', industry: 'Restaurant' },
        confirmed_on: before.evaluated_on, source_reference: 'Synthetic authorized call', permission: 'permitted', contactability: 'verified_email', relationship: 'new' };
      assert.equal((await save(0, profile)).revision, 1);
      assert.equal((await save(0, profile)).revision, 1, 'Same unchanged retry must not duplicate profile history');
      let current = await context();
      assert.notEqual(current.evidence_token, before.evidence_token);
      const draft = randomUUID();
      const draftAction = async (id, revision, action, token, subject = 'Business review', body = 'Would a brief business insurance review be useful?', user = actor) =>
        (await tx.$queryRawUnsafe('select save_opportunity_draft($1::uuid,\'lead\',$2::uuid,$3::uuid,$4::integer,$5,$6,$7,$8) as value',
          user, lead, id, revision, action, token, subject, body))[0].value;
      let saved = await draftAction(draft, 0, 'save', current.evidence_token);
      assert.equal(saved.revision, 1);
      assert.equal((await draftAction(draft, 0, 'save', current.evidence_token)).revision, 1);
      await expected(tx, () => draftAction(draft, 1, 'approve', current.evidence_token, 'Unreviewed subject'), 'PT409');
      saved = await draftAction(draft, 1, 'approve', current.evidence_token);
      assert.equal(saved.state, 'approved');
      await save(1, { ...profile, permission: 'do_not_contact' });
      await expected(tx, () => draftAction(draft, 1, 'approve', current.evidence_token), 'PT409');
      current = await context();
      const claim = async (id, reference, subject, body) => (await tx.$queryRawUnsafe('select claim_opportunity_send($1::uuid,\'lead\',$2::uuid,$3::uuid,$4::uuid,$5,$6) as value',
        actor, lead, id, reference, subject, body))[0].value;
      await expected(tx, () => claim(draft, saved.request_id, saved.subject, saved.body), 'PT409');
      saved = await draftAction(draft, 1, 'save', current.evidence_token);
      await expected(tx, () => draftAction(draft, 2, 'approve', current.evidence_token), '22023');
      await save(2, profile); current = await context();
      saved = await draftAction(draft, 2, 'save', current.evidence_token);
      saved = await draftAction(draft, 3, 'approve', current.evidence_token);
      await expected(tx, () => claim(draft, saved.request_id, saved.subject, 'Changed content'), '42501');
      assert.equal((await claim(draft, saved.request_id, saved.subject, saved.body)).state, 'dispatching');
      await expected(tx, () => claim(draft, saved.request_id, saved.subject, saved.body), 'PT409');
      await tx.$queryRawUnsafe("select finish_opportunity_send($1::uuid,$2::uuid,'uncertain')::text", actor, draft);
      await expected(tx, () => draftAction(draft, 3, 'save', current.evidence_token), 'PT409');
      const task = randomUUID(), due = new Date(Date.now() + 86400000).toISOString();
      const taskAction = async (assignee = actor) => (await tx.$queryRawUnsafe('select create_opportunity_task($1::uuid,\'lead\',$2::uuid,$3,$4::uuid,$5::timestamptz,$6::uuid) as value',
        actor, lead, current.evidence_token, task, due, assignee))[0].value;
      const created = await taskAction();
      assert.equal(created.id, task); assert.ok(created.action_href.includes(lead));
      assert.equal((await taskAction()).id, task, 'Task retry must remain idempotent');
      await expected(tx, () => taskAction(agent), '42501');
      const queue = await tx.$queryRawUnsafe('select opportunity_queue($1::uuid,0) as value', actor);
      assert.ok(queue[0].value.items.some((item) => item.id === lead));
      const hidden = await tx.$queryRawUnsafe('select opportunity_queue($1::uuid,0) as value', agent);
      assert.ok(!hidden[0].value.items.some((item) => item.id === lead));
      const carrier = randomUUID();
      await tx.$queryRawUnsafe("select save_carrier_appetite($1::uuid,$2::uuid,0,'reserve',$3::jsonb)", actor, carrier,
        JSON.stringify({ file_name: 'synthetic.txt', file_size: 10, content_type: 'text/plain', storage_path: `carrier-appetite/${carrier}/synthetic.txt` }));
      const carrierValues = { carrier: `QA ${carrier}`, title: 'Guide', line: 'GL', states: 'AZ', effective_on: '2026-01-01', expires_on: '2028-01-01',
        rights_reference: 'Synthetic fixture', access: 'unconfirmed', access_reference: '', rules: [{ id: randomUUID(), page: 1, criterion: 'Restaurant', excerpt: 'Restaurant', decision: 'eligible' }] };
      await tx.$queryRawUnsafe("select save_carrier_appetite($1::uuid,$2::uuid,0,'save',$3::jsonb)", actor, carrier, JSON.stringify({ values: carrierValues, pages: [{ page: 1, text: 'Restaurant' }] }));
      before = await context();
      await tx.$queryRawUnsafe("select save_carrier_appetite($1::uuid,$2::uuid,1,'activate','{}'::jsonb)", actor, carrier);
      current = await context(); assert.notEqual(before.evidence_token, current.evidence_token, 'New active evidence must invalidate prior drafts');
      const newDraft = randomUUID(); saved = await draftAction(newDraft, 0, 'save', current.evidence_token);
      saved = await draftAction(newDraft, 1, 'approve', current.evidence_token);
      await tx.$queryRawUnsafe("select save_carrier_appetite($1::uuid,$2::uuid,2,'withdraw','{}'::jsonb)", actor, carrier);
      await expected(tx, () => claim(newDraft, saved.request_id, saved.subject, saved.body), 'PT409');
      await tx.$executeRawUnsafe("update leads set email='changed@example.test' where id=$1::uuid", lead);
      current = await context();
      assert.equal(current.profile.profile.contactability, 'unknown', 'An edited recipient does not inherit the previous address verification');
      const changedRecipientDraft = randomUUID();
      await draftAction(changedRecipientDraft, 0, 'save', current.evidence_token);
      await expected(tx, () => draftAction(changedRecipientDraft, 1, 'approve', current.evidence_token), '22023');
      await save(3, profile);
      current = await context(); assert.equal(current.profile.profile.contactability, 'verified_email');
      await tx.$executeRawUnsafe("update leads set email=null where id=$1::uuid", lead);
      await expected(tx, () => save(4, profile), '22023');
      const account = randomUUID();
      await tx.$executeRawUnsafe("insert into clients(id,full_name,email,agent_user_id) values($1::uuid,'Synthetic linked OIP account','qa-linked@example.test',$2::uuid)", account, actor);
      await tx.$executeRawUnsafe('update leads set account_id=$1::uuid where id=$2::uuid', account, lead);
      const linked = await context();
      assert.equal(linked.dossier.scope_key, `client:${account}`); assert.equal(linked.profile.revision, 0);
      await expected(tx, () => claim(newDraft, saved.request_id, saved.subject, saved.body), '42501');
      const permissions = await tx.$queryRawUnsafe(`select has_table_privilege('authenticated','opportunity_drafts','SELECT') as browser,
        has_table_privilege('service_role','opportunity_drafts','UPDATE') as direct_write,
        has_function_privilege('authenticated','claim_opportunity_send(uuid,text,uuid,uuid,uuid,text,text)','EXECUTE') as claim`);
      assert.deepEqual(permissions[0], { browser: false, direct_write: false, claim: false });
      const settings = { industries: 'Restaurant', states: 'AZ', lines: 'General liability', excluded_industries: '',
        revenue_min: null, revenue_max: null, renewal_days: 90, agent_capacity: 10, recurring_enabled: true, refresh_days: 7, digest_hour: 0 };
      await expected(tx, () => tx.$queryRawUnsafe('select save_opportunity_settings($1::uuid,0,$2::jsonb)', agent, JSON.stringify(settings)), '42501');
      await tx.$queryRawUnsafe('select save_opportunity_settings($1::uuid,0,$2::jsonb)', actor, JSON.stringify(settings));
      const operation = async (action, payload, request = randomUUID(), user = actor) =>
        (await tx.$queryRawUnsafe('select opportunity_operation($1::uuid,\'client\',$2::uuid,$3::uuid,$4,$5::jsonb) as value',
          user, account, request, action, JSON.stringify(payload)))[0].value;
      const outcomeId = randomUUID(), outcome = { stage: 'qualified', occurred_on: new Date().toISOString().slice(0, 10), source: 'Synthetic fixture', reason: '', cost: 0, premium: null };
      assert.equal((await operation('outcome', outcome, outcomeId)).id, outcomeId);
      assert.equal((await operation('outcome', outcome, outcomeId)).id, outcomeId);
      await expected(tx, () => operation('outcome', { ...outcome, cost: 20 }, outcomeId), 'PT409');
      await expected(tx, () => operation('outcome', outcome, randomUUID(), agent), '42501');
      await expected(tx, () => operation('outcome', { ...outcome, stage: 'declined' }), '22023');
      const evidenceId = randomUUID();
      const beforeEvidence = await context();
      await operation('evidence', { kind: 'location', value: 'New verified branch', previous_value: 'Old branch', previous_as_of: '2025-01-01',
        reference: 'Synthetic business-authorized confirmation', source_as_of: outcome.occurred_on, confirmed: true }, evidenceId);
      assert.notEqual((await context()).evidence_token, beforeEvidence.evidence_token);
      await expected(tx, () => operation('evidence', { kind: 'location', value: 'Same source is not growth', source_as_of: outcome.occurred_on, reference: 'Synthetic', confirmed: true }), '22023');
      await expected(tx, () => operation('evidence', { kind: 'document', value: 'Private policy fact', source_as_of: outcome.occurred_on,
        reference: 'Synthetic', confirmed: true, document_id: randomUUID() }), '42501');
      const requestId = randomUUID();
      await operation('request', { questions: 'Which lines and renewal timing should we review?' }, requestId);
      const linkHash = 'a'.repeat(64);
      await tx.$queryRawUnsafe('select share_opportunity_questionnaire($1::uuid,\'client\',$2::uuid,$3::uuid,$4,false)', actor, account, requestId, linkHash);
      const publicView = (await tx.$queryRawUnsafe('select public_opportunity_questionnaire($1) as value', linkHash))[0].value;
      assert.equal(publicView.questions, 'Which lines and renewal timing should we review?');
      assert.deepEqual(Object.keys(publicView).sort(), ['expires_at', 'questions', 'submitted']);
      await expected(tx, () => tx.$queryRawUnsafe("select public_opportunity_questionnaire($1,'Business response',false)", linkHash), '22023');
      await tx.$queryRawUnsafe("select public_opportunity_questionnaire($1,'Business response',true)", linkHash);
      await tx.$queryRawUnsafe("select public_opportunity_questionnaire($1,'Business response',true)", linkHash);
      await expected(tx, () => tx.$queryRawUnsafe("select public_opportunity_questionnaire($1,'Different response',true)", linkHash), 'PT409');
      const responded = (await tx.$queryRawUnsafe('select get_opportunity_operations($1::uuid,\'client\',$2::uuid) as value', actor, account))[0].value;
      assert.equal(responded.requests[0].state, 'responded', 'Public responses must not become agent-confirmed facts');
      await tx.$queryRawUnsafe('select share_opportunity_questionnaire($1::uuid,\'client\',$2::uuid,$3::uuid,null,true)', actor, account, requestId);
      await expected(tx, () => tx.$queryRawUnsafe('select public_opportunity_questionnaire($1)', linkHash), 'P0002');
      await operation('answer', { request_id: requestId, response: 'General liability', reference: 'Authorized synthetic answer', source_as_of: outcome.occurred_on });
      const relationshipId = randomUUID();
      await expected(tx, () => operation('relationship', { name: 'Business contact', reference: 'Synthetic', opt_in: false }), '22023');
      await operation('relationship', { name: 'Business contact', reference: 'Synthetic permitted introduction', opt_in: true }, relationshipId);
      await operation('relationship_review', { relationship_id: relationshipId, state: 'approved' });
      const ops = (await tx.$queryRawUnsafe('select get_opportunity_operations($1::uuid,\'client\',$2::uuid) as value', actor, account))[0].value;
      assert.equal(ops.requests[0].state, 'answered'); assert.equal(ops.relationships[0].state, 'approved');
      assert.equal(ops.outcomes.filter((item) => item.id === outcomeId).length, 1);
      const correctedId = randomUUID();
      await operation('outcome', { ...outcome, cost: 5, supersedes: outcomeId }, correctedId);
      await expected(tx, () => operation('outcome', { ...outcome, cost: 10, supersedes: outcomeId }), 'PT409');
      const corrected = (await tx.$queryRawUnsafe('select get_opportunity_operations($1::uuid,\'client\',$2::uuid) as value', actor, account))[0].value;
      assert.equal(corrected.outcomes.some((item) => item.id === outcomeId), false);
      assert.equal(corrected.outcomes.find((item) => item.id === correctedId).cost, 5);
      await tx.$queryRawUnsafe('select save_opportunity_profile($1::uuid,\'client\',$2::uuid,$3,0,$4::jsonb)', actor, account, `client:${account}`, JSON.stringify(profile));
      const watch = (await tx.$queryRawUnsafe('select set_opportunity_watch($1::uuid,\'client\',$2::uuid,true) as value', actor, account))[0].value;
      const claims = (await tx.$queryRawUnsafe('select claim_opportunity_jobs(4) as value'))[0].value;
      const claimWatch = claims.find((item) => item.id === watch.id);
      assert.ok(claimWatch); assert.ok(!(await tx.$queryRawUnsafe('select claim_opportunity_jobs(4) as value'))[0].value.some((item) => item.id === watch.id));
      const snapshot = { evidence_token: (await context()).evidence_token, assessment: { score: { total: 40 } } };
      await expected(tx, () => tx.$queryRawUnsafe('select finish_opportunity_job($1::uuid,$2::uuid,$3::jsonb,null)', watch.id, randomUUID(), JSON.stringify(snapshot)), 'PT409');
      await tx.$queryRawUnsafe('select finish_opportunity_job($1::uuid,$2::uuid,$3::jsonb,null)', watch.id, claimWatch.lease_token, JSON.stringify(snapshot));
      await expected(tx, () => tx.$queryRawUnsafe('select finish_opportunity_job($1::uuid,$2::uuid,$3::jsonb,null)', watch.id, claimWatch.lease_token, JSON.stringify(snapshot)), 'PT409');
      const dashboard = (await tx.$queryRawUnsafe('select get_opportunity_dashboard($1::uuid) as value', actor))[0].value;
      assert.ok(dashboard.watches.some((item) => item.id === watch.id)); assert.ok(dashboard.outcomes.some((item) => item.scope_key === `client:${account}`));
      const agentDashboard = (await tx.$queryRawUnsafe('select get_opportunity_dashboard($1::uuid) as value', agent))[0].value;
      assert.ok(!agentDashboard.outcomes.some((item) => item.scope_key === `client:${account}`));
      await tx.$executeRawUnsafe("update opportunity_watches set next_due_at=clock_timestamp()-interval '100 years' where id=$1::uuid", watch.id);
      const retryLease = (await tx.$queryRawUnsafe('select claim_opportunity_jobs(4) as value'))[0].value.find((item) => item.id === watch.id);
      await tx.$executeRawUnsafe("update opportunity_watches set lease_until=clock_timestamp()-interval '1 second',next_due_at=clock_timestamp()-interval '100 years' where id=$1::uuid", watch.id);
      const recovered = (await tx.$queryRawUnsafe('select claim_opportunity_jobs(4) as value'))[0].value.find((item) => item.id === watch.id);
      assert.ok(recovered); assert.notEqual(recovered.lease_token, retryLease.lease_token);
      assert.equal((await tx.$queryRawUnsafe('select state from opportunity_job_history where lease_token=$1::uuid', retryLease.lease_token))[0].state, 'failed');
      await expected(tx, () => tx.$queryRawUnsafe('select finish_opportunity_job($1::uuid,$2::uuid,$3::jsonb,null)', watch.id, retryLease.lease_token, JSON.stringify(snapshot)), 'PT409');
      const latestContext = await context();
      const digestSnapshot = { evidence_token: latestContext.evidence_token, record_name: 'Synthetic linked OIP account',
        profile: latestContext.profile, assessment: { status: 'needs_review', score: { total: 40 } } };
      await tx.$queryRawUnsafe('select finish_opportunity_job($1::uuid,$2::uuid,$3::jsonb,null)', watch.id, recovered.lease_token, JSON.stringify(digestSnapshot));
      await tx.$queryRawUnsafe('select build_opportunity_digests()');
      const digestCount = (await tx.$queryRawUnsafe('select count(*)::integer as n from opportunity_digests where actor_id=$1::uuid', actor))[0].n;
      await tx.$queryRawUnsafe('select build_opportunity_digests()');
      assert.equal((await tx.$queryRawUnsafe('select count(*)::integer as n from opportunity_digests where actor_id=$1::uuid', actor))[0].n, digestCount);
      const guards = await tx.$queryRawUnsafe(`select has_table_privilege('authenticated','opportunity_operation_events','SELECT') as browser,
        has_function_privilege('authenticated','claim_opportunity_jobs(integer)','EXECUTE') as execution,
        has_function_privilege('service_role','get_opportunity_core_context(uuid,text,uuid)','EXECUTE') as core`);
      assert.deepEqual(guards[0], { browser: false, execution: false, core: false });
      console.log('OIP operations verified: owner settings, canonical evidence, outcome retries, request answers, relationship opt-in, watch claims, lease fencing and scoped dashboard.');
      console.log('OIP SQL verified: scoped matching facts, privacy, exact approval, permission/source revocation, guarded once-only dispatch, task links/retries, queue isolation and audit history. All schema and fixtures rolling back; no provider was called.');
      throw rollback;
    }, { timeout: 180000 });
  } catch (error) { if (error !== rollback) throw error; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
