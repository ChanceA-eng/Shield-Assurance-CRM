const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
if (process.argv.includes('--use-local')) require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
const url = process.argv.includes('--use-local') ? process.env.DIRECT_URL || process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL or explicitly use --use-local; all changes roll back.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('QUESTIONNAIRE_ROLLBACK_VERIFIED');
const hash = (value) => createHash('sha256').update(value).digest('hex');
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
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261114010000_prospect_questionnaires.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      const installed = await tx.$queryRawUnsafe("select to_regclass('public.prospect_questionnaire_requests') is not null as installed");
      if (!installed[0].installed) await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${sql}$migration$; END $verify$;`);
      const actor = randomUUID(), other = randomUUID(), admin = randomUUID();
      for (const [id, role] of [[actor, 'agent'], [other, 'agent'], [admin, 'admin']]) {
        await tx.$executeRawUnsafe('insert into auth.users(id,email) values($1::uuid,$2)', id, `questionnaire-${id}@example.invalid`);
        await tx.$executeRawUnsafe('insert into agency_members(user_id,email,role,active) values($1::uuid,$2,$3,true)', id, `questionnaire-${id}@example.invalid`, role);
      }
      const staff = async (who, action, data = {}) => (await tx.$queryRawUnsafe(
        'select prospect_questionnaire_staff($1::uuid,$2,$3::jsonb) as value', who, action, JSON.stringify(data)))[0].value;
      const publicAction = async (token, action, data = {}) => (await tx.$queryRawUnsafe(
        'select prospect_questionnaire_public($1,$2,$3::jsonb) as value', hash(token), action, JSON.stringify(data)))[0].value;
      const templates = await staff(actor, 'templates');
      const original = templates.find((row) => row.design.name === 'Prospect information');
      const copyId = randomUUID(), otherCopy = randomUUID();
      const design = { ...original.design, name: 'Agent A request' };
      const copy = await staff(actor, 'save_template', { id: copyId, expected: 0, source_id: original.id, design });
      assert.equal(copy.owner_id, actor);
      assert.equal((await staff(actor, 'save_template', { id: copyId, expected: 0, source_id: original.id, design })).revision, 1);
      await staff(other, 'save_template', { id: otherCopy, expected: 0, source_id: original.id, design: { ...design, name: 'Agent B request' } });
      assert.ok(!(await staff(other, 'templates')).some((row) => row.id === copyId));
      assert.equal((await staff(actor, 'templates')).find((row) => row.id === original.id).design.name, original.design.name);
      await expected(tx, () => staff(other, 'save_template', { id: copyId, expected: 1, design }), '42501');
      await expected(tx, () => staff(actor, 'save_template', { id: original.id, expected: 1, design }), '42501');
      const requestId = randomUUID(), token = 'synthetic-link', session = hash('synthetic-session');
      const future = new Date(Date.now() + 86400000).toISOString();
      await staff(actor, 'create_request', { id: requestId, template_id: copyId, design, recipient: `qa-${requestId}@example.invalid`,
        recipient_name: 'Synthetic prospect', token_hash: hash(token), expires_at: future });
      assert.equal((await publicAction(token, 'form', { session_hash: session })).status, 401);
      await publicAction(token, 'challenge', { code_hash: hash('code'), network: hash('test-network'),
        contact: { first_name: 'Synthetic', last_name: 'Prospect' } });
      assert.equal((await publicAction(token, 'verify', { code_hash: hash('wrong'), new_session: session })).status, 403);
      assert.equal((await publicAction(token, 'verify', { code_hash: hash('code'), new_session: session })).verified, true);
      await tx.$executeRawUnsafe("update prospect_questionnaire_requests set expires_at=now()-interval '1 minute' where id=$1::uuid", requestId);
      await tx.$executeRawUnsafe("update prospect_questionnaire_challenges set session_expires_at=now()-interval '1 minute' where request_id=$1::uuid", requestId);
      const lifecycleSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261114020000_prospect_intake_close_on_submit.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${lifecycleSql}$migration$; END $verify$;`);
      assert.equal((await tx.$queryRawUnsafe("select expires_at='infinity'::timestamptz as unlimited from prospect_questionnaire_requests where id=$1::uuid", requestId))[0].unlimited, true);
      assert.equal((await tx.$queryRawUnsafe("select session_expires_at='infinity'::timestamptz as unlimited from prospect_questionnaire_challenges where request_id=$1::uuid", requestId))[0].unlimited, true);
      const timeoutSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261114030000_prospect_intake_thirty_minutes.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${timeoutSql}$migration$; END $verify$;`);
      const deadline = (await tx.$queryRawUnsafe("select extract(epoch from (r.expires_at-r.created_at))::float as seconds,c.session_expires_at=r.expires_at as bounded from prospect_questionnaire_requests r join prospect_questionnaire_challenges c on c.request_id=r.id where r.id=$1::uuid", requestId))[0];
      assert.equal(deadline.seconds, 1800, 'Existing links expire thirty minutes after generation');
      assert.equal(deadline.bounded, true, 'Verification cannot extend the link deadline');
      assert.equal((await publicAction(token, 'form', { session_hash: session })).design.name, 'Agent A request');
      assert.equal((await staff(actor, 'invitation', { id: requestId, token_hash: hash(token) })).recipient, `qa-${requestId}@example.invalid`);
      await expected(tx, () => staff(actor, 'invitation', { id: requestId, token_hash: hash('wrong-link') }), 'PT409');
      await expected(tx, () => staff(other, 'invitation', { id: requestId, token_hash: hash(token) }), '42501');
      const answers = { [design.questions[0].id]: 'Submitted different name' };
      assert.equal((await publicAction(token, 'submit', { session_hash: session, consent: true, answers })).submitted, true);
      await expected(tx, () => staff(actor, 'invitation', { id: requestId, token_hash: hash(token) }), 'PT409');
      assert.equal((await publicAction(token, 'submit', { session_hash: session, consent: true, answers })).submitted, true);
      assert.equal((await publicAction(token, 'challenge', { code_hash: hash('new'), network: hash('new-network') })).status, 410);
      const rows = await staff(actor, 'requests');
      assert.equal(rows.length, 1); assert.equal(rows[0].submissions.length, 1);
      assert.equal(rows[0].submissions[0].state, 'needs_review'); assert.equal(rows[0].can_reopen, false);
      assert.deepEqual(rows[0].submissions[0].contact, { first_name: 'Synthetic', last_name: 'Prospect' });
      assert.equal((await staff(actor, 'context', { target_type: 'lead', target_id: rows[0].target_id })).name, 'Synthetic prospect');
      await expected(tx, () => staff(other, 'context', { target_type: 'lead', target_id: rows[0].target_id }), '42501');
      assert.equal((await tx.$queryRawUnsafe('select full_name from leads where id=$1::uuid', rows[0].target_id))[0].full_name, 'Synthetic prospect');
      assert.equal((await tx.$queryRawUnsafe('select count(*)::int as n from tasks where related_id=$1::uuid', rows[0].target_id))[0].n, 1);
      assert.equal((await tx.$queryRawUnsafe('select action_href from tasks where related_id=$1::uuid', rows[0].target_id))[0].action_href,
        `/leads?lead=${rows[0].target_id}&intake=1`);
      assert.equal((await staff(other, 'requests')).length, 0);
      await expected(tx, () => staff(actor, 'reopen', { id: requestId, expires_at: future, token_hash: hash('new-token') }), '42501');
      await staff(actor, 'review', { id: requestId, submission_id: rows[0].submissions[0].id, fields: ['full_name'],
        decision: 'accepted', expected_values: rows[0].current_values });
      assert.equal((await tx.$queryRawUnsafe('select full_name from leads where id=$1::uuid', rows[0].target_id))[0].full_name, 'Submitted different name');
      await expected(tx, () => staff(actor, 'review', { id: requestId, submission_id: rows[0].submissions[0].id, fields: [],
        decision: 'accepted', expected_values: rows[0].current_values }), 'PT409');
      await staff(admin, 'reopen', { id: requestId, token_hash: hash('new-token') });
      assert.equal((await publicAction(token, 'form', { session_hash: session })).status, 410);
      assert.equal((await publicAction('new-token', 'form', { session_hash: session })).status, 401);
      const reopened = (await staff(actor, 'requests'))[0];
      assert.equal(reopened.revision, 2); assert.equal(reopened.submissions.length, 1);
      assert.equal(reopened.submissions[0].answers[design.questions[0].id], 'Submitted different name');
      await staff(actor, 'revoke', { id: requestId });
      assert.equal((await publicAction('new-token', 'form', { session_hash: session })).status, 410);
      const another = randomUUID(), fileQuestion = randomUUID();
      const fileDesign = { name: 'Documents only', questions: [{ id: fileQuestion, label: 'ID', type: 'file', required: true, options: [], field: '' }] };
      await staff(actor, 'create_request', { id: another, template_id: copyId, design: fileDesign, recipient: `qa-${another}@example.invalid`,
        recipient_name: 'Synthetic files', token_hash: hash('files') });
      const generated = (await tx.$queryRawUnsafe("select extract(epoch from (expires_at-created_at))::float as seconds from prospect_questionnaire_requests where id=$1::uuid", another))[0].seconds;
      assert.ok(Math.abs(generated - 1800) < 1, `New request deadline: ${generated} seconds`);
      await publicAction('files', 'challenge', { code_hash: hash('file-code'), network: hash('file-network') });
      for (let attempt = 0; attempt < 5; attempt++) assert.equal(
        (await publicAction('files', 'verify', { code_hash: hash('bad'), new_session: session })).status, 403);
      assert.equal((await publicAction('files', 'verify', { code_hash: hash('file-code'), new_session: session })).status, 403, 'Lockout persists after wrong codes');
      await tx.$executeRawUnsafe("update prospect_questionnaire_challenges set sent_at=now()-interval '2 minutes' where request_id=$1::uuid", another);
      await publicAction('files', 'challenge', { code_hash: hash('file-code'), network: hash('file-network') });
      assert.equal((await publicAction('files', 'verify', { code_hash: hash('file-code'), new_session: session })).verified, true);
      await tx.$executeRawUnsafe("update prospect_questionnaire_challenges set sent_at=now()-interval '2 hours',expires_at=now()-interval '2 hours' where request_id=$1::uuid", another);
      assert.equal((await publicAction('files', 'form', { session_hash: session })).design.name, 'Documents only', 'Used code expiration does not end an otherwise valid request session');
      const uploadData = (size = 10485760) => ({ session_hash: session, id: randomUUID(), question_id: fileQuestion, name: 'synthetic.png', size, type: 'image/png' });
      await expected(tx, () => publicAction('files', 'upload', uploadData()), '22023');
      await tx.$queryRawUnsafe("select prospect_questionnaire_scan('claim',$1::jsonb) as value", JSON.stringify({ version: 'synthetic-current-signatures' }));
      await expected(tx, () => publicAction('files', 'upload', uploadData()), '22023');
      await tx.$queryRawUnsafe("select prospect_questionnaire_cleanup_job('claim','{}'::jsonb)");
      const uploads = [];
      for (let index = 0; index < 5; index++) uploads.push(await publicAction('files', 'upload', uploadData()));
      await expected(tx, () => publicAction('files', 'upload', uploadData()), '22023');
      await expected(tx, () => publicAction('files', 'submit', { session_hash: session, consent: true, answers: {} }), '22023');
      for (const upload of uploads) await tx.$executeRawUnsafe(
        "insert into storage.objects(bucket_id,name,metadata) values('prospect-documents',$1,$2::jsonb)",
        upload.storage_path, JSON.stringify({ size: upload.size, mimetype: upload.content_type }));
      await publicAction('files', 'submit', { session_hash: session, consent: true, answers: {} });
      await expected(tx, () => staff(actor, 'file', { id: another, file_id: uploads[0].id }), '42501');
      await tx.$executeRawUnsafe("update prospect_questionnaire_files set created_at=now()-interval '1 minute' where request_id=$1::uuid", another);
      const claimed = (await tx.$queryRawUnsafe("select prospect_questionnaire_scan('claim',$1::jsonb) as value", JSON.stringify({ version: 'synthetic-current-signatures' })))[0].value;
      assert.ok(claimed.lease);
      await expected(tx, () => tx.$queryRawUnsafe("select prospect_questionnaire_scan('finish',$1::jsonb)",
        JSON.stringify({ id: claimed.id, lease: randomUUID(), state: 'clean', digest: hash('synthetic'), version: 'synthetic' })), 'PT409');
      await tx.$queryRawUnsafe("select prospect_questionnaire_scan('finish',$1::jsonb)", JSON.stringify({
        id: claimed.id, lease: claimed.lease, state: 'clean', digest: hash('synthetic'), version: 'synthetic' }));
      assert.equal((await staff(actor, 'file', { id: another, file_id: claimed.id })).digest, hash('synthetic'));
      await expected(tx, () => staff(other, 'file', { id: another, file_id: claimed.id }), '42501');
      await tx.$executeRawUnsafe("update prospect_questionnaire_files set state='blocked' where id=$1::uuid", claimed.id);
      await expected(tx, () => staff(actor, 'file', { id: another, file_id: claimed.id }), '42501');
      const fileRequest = (await staff(actor, 'requests')).find((row) => row.id === another);
      const account = randomUUID();
      await tx.$executeRawUnsafe("insert into clients(id,full_name,email,agent_user_id) values($1::uuid,'Synthetic linked account',$2,$3::uuid)",
        account, `qa-account-${account}@example.invalid`, actor);
      await tx.$executeRawUnsafe('update leads set account_id=$1::uuid where id=$2::uuid', account, fileRequest.target_id);
      const accountRequests = await staff(actor, 'requests', { target_type: 'client', target_id: account });
      assert.equal(accountRequests.length, 1);
      assert.equal(accountRequests[0].submissions[0].id, fileRequest.submissions[0].id);
      assert.ok(accountRequests[0].files.some((file) => file.id === claimed.id), 'Linked account retains original document references');
      assert.equal((await staff(actor, 'context', { target_type: 'client', target_id: account })).name, 'Synthetic linked account');
      assert.equal((await staff(other, 'requests', { target_type: 'client', target_id: account })).length, 0);
      await expected(tx, () => staff(other, 'context', { target_type: 'client', target_id: account }), '42501');
      const expired = randomUUID();
      await staff(actor, 'create_request', { id: expired, template_id: copyId, design: fileDesign, recipient: `qa-${expired}@example.invalid`,
        recipient_name: 'Open draft', token_hash: hash('expired-draft'), expires_at: '2020-01-01' });
      await publicAction('expired-draft', 'challenge', { code_hash: hash('expired-code'), network: hash('expired-network') });
      await tx.$executeRawUnsafe("update prospect_questionnaire_challenges set expires_at=now()-interval '1 second' where request_id=$1::uuid", expired);
      assert.equal((await publicAction('expired-draft', 'verify', { code_hash: hash('expired-code'), new_session: session })).status, 403, 'Unused email codes still expire');
      await tx.$executeRawUnsafe("update prospect_questionnaire_challenges set expires_at=now()+interval '10 minutes' where request_id=$1::uuid", expired);
      await publicAction('expired-draft', 'verify', { code_hash: hash('expired-code'), new_session: session });
      const abandonedFile = await publicAction('expired-draft', 'upload', uploadData(20));
      await tx.$executeRawUnsafe("update prospect_questionnaire_requests set expires_at=clock_timestamp()+interval '1 minute' where id=$1::uuid", expired);
      assert.equal((await publicAction('expired-draft', 'form', { session_hash: session })).files.length, 1);
      await tx.$executeRawUnsafe("update prospect_questionnaire_requests set expires_at=clock_timestamp() where id=$1::uuid", expired);
      for (const action of ['form', 'challenge', 'verify', 'upload', 'submit']) {
        assert.equal((await publicAction('expired-draft', action, { ...uploadData(20), code_hash: hash('expired-code'), new_session: session, consent: true, answers: {} })).status, 410, `${action} closes at the deadline`);
      }
      await expected(tx, () => staff(actor, 'invitation', { id: expired, token_hash: hash('expired-draft') }), 'PT409');
      const restarted = await staff(actor, 'rotate', { id: expired, token_hash: hash('fresh-draft') });
      assert.equal(restarted.revision, 2);
      const replacementDeadline = (await tx.$queryRawUnsafe("select extract(epoch from (expires_at-clock_timestamp()))::float as seconds from prospect_questionnaire_requests where id=$1::uuid", expired))[0].seconds;
      assert.ok(replacementDeadline > 1795 && replacementDeadline <= 1800, 'Replacement receives a fresh thirty-minute deadline');
      assert.equal((await publicAction('expired-draft', 'form', { session_hash: session })).status, 410);
      assert.equal((await publicAction('fresh-draft', 'form', { session_hash: session })).status, 401);
      await publicAction('fresh-draft', 'challenge', { code_hash: hash('fresh-code'), network: hash('fresh-network') });
      await publicAction('fresh-draft', 'verify', { code_hash: hash('fresh-code'), new_session: session });
      assert.deepEqual((await publicAction('fresh-draft', 'form', { session_hash: session })).files, []);
      assert.equal((await tx.$queryRawUnsafe('select state from prospect_questionnaire_files where id=$1::uuid', abandonedFile.id))[0].state, 'removed');
      const cleanupJob = async (action, data = {}) => (await tx.$queryRawUnsafe(
        'select prospect_questionnaire_cleanup_job($1,$2::jsonb) as value', action, JSON.stringify(data)))[0].value;
      assert.equal(await cleanupJob('claim'), null, 'Outstanding signed upload tickets delay abandoned-file deletion');
      await tx.$executeRawUnsafe("update prospect_questionnaire_files set ticket_expires_at=now()-interval '1 minute' where id=$1::uuid", abandonedFile.id);
      const abandonedJob = await cleanupJob('claim');
      assert.equal(abandonedJob.id, abandonedFile.id);
      await expected(tx, () => cleanupJob('finish', { id: abandonedJob.id, lease: randomUUID() }), 'PT409');
      await cleanupJob('finish', { id: abandonedJob.id, lease: abandonedJob.lease });
      assert.ok((await tx.$queryRawUnsafe('select purged_at from prospect_questionnaire_files where id=$1::uuid', abandonedFile.id))[0].purged_at);
      await staff(actor, 'revoke', { id: expired });
      assert.equal((await publicAction('fresh-draft', 'form', { session_hash: session })).status, 410);
      await tx.$executeRawUnsafe("update prospect_questionnaire_files set state='clean' where id=$1::uuid", claimed.id);
      assert.equal((await staff(actor, 'file', { id: another, file_id: claimed.id })).id, claimed.id);
      await tx.$executeRawUnsafe("update prospect_questionnaire_submissions set created_at=clock_timestamp()-interval '24 hours 1 second' where request_id=$1::uuid", another);
      await expected(tx, () => staff(actor, 'file', { id: another, file_id: claimed.id }), '42501');
      const expiredFiles = (await staff(actor, 'requests')).find((row) => row.id === another).files;
      assert.ok(expiredFiles.every((file) => file.state === 'expired'), 'The 24-hour access deadline does not depend on cleanup running');
      await tx.$executeRawUnsafe("update prospect_questionnaire_files set ticket_expires_at=now()-interval '1 minute' where request_id=$1::uuid", another);
      const submittedJob = await cleanupJob('claim');
      assert.ok(uploads.some((file) => file.id === submittedJob.id));
      await cleanupJob('finish', { id: submittedJob.id, lease: submittedJob.lease });
      assert.ok((await tx.$queryRawUnsafe('select purged_at from prospect_questionnaire_files where id=$1::uuid', submittedJob.id))[0].purged_at);
      const privileges = await tx.$queryRawUnsafe("select has_table_privilege('anon','public.prospect_questionnaire_files','SELECT') as files, has_function_privilege('authenticated','public.prospect_questionnaire_staff(uuid,text,jsonb)','EXECUTE') as staff");
      assert.equal(privileges[0].files, false); assert.equal(privileges[0].staff, false);
      throw rollback;
    }, { timeout: 120000 });
  } catch (failure) {
    if (failure !== rollback) throw failure;
    console.log('Questionnaire schema, private forks, verification, atomic submission, review and administrator-only reopen verified; all changes rolled back.');
  } finally { await db.$disconnect(); }
}
main().catch((failure) => { console.error(failure); process.exitCode = 1; });
