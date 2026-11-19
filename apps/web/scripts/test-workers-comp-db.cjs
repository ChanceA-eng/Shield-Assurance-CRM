const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
const local = process.argv.includes('--use-local');
if (local) require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] }))
  .config({ path: path.join(root, 'apps', 'web', '.env.local') });
const url = local ? process.env.DIRECT_URL || process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL or explicitly use --use-local; all changes roll back.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('WORKERS_COMP_ROLLBACK_VERIFIED');
async function expected(tx, work, code) {
  await tx.$executeRawUnsafe('SAVEPOINT expected_failure');
  let failure;
  try { await work(); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_failure');
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_failure');
  assert.ok(failure, `Expected ${code}`);
  assert.equal(failure.meta?.code, code, failure.message);
}
async function main() {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      const installed = await tx.$queryRawUnsafe("select to_regclass('public.workers_comp_evidence')::text as name");
      if (!installed[0].name) {
        const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261117010000_workers_comp_evidence.sql'), 'utf8')
          .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
        await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${sql}$migration$; END $verify$;`);
      }
      const conflictFix = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261117012000_workers_comp_record_isolation.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${conflictFix}$migration$; END $verify$;`);
      const owner = (await tx.$queryRawUnsafe("select user_id from agency_members where active and role='owner' limit 1"))[0]?.user_id;
      assert.ok(owner, 'Active owner required.');
      const agent = randomUUID(), outsider = randomUUID(), lead = randomUUID(), other = randomUUID(), id = randomUUID();
      await tx.$executeRawUnsafe('insert into auth.users(id,email) values($1::uuid,$2)', agent, `wc-${agent}@example.invalid`);
      await tx.$executeRawUnsafe("insert into agency_members(user_id,email,role,active) values($1::uuid,$2,'agent',true)", agent, `wc-${agent}@example.invalid`);
      for (const [record, assigned] of [[lead, owner], [other, agent]]) {
        await tx.$executeRawUnsafe("insert into leads(id,full_name,email,source,status,agent_user_id) values($1::uuid,'Synthetic WC employer',$2,'browser_qa','new',$3::uuid)",
          record, `wc-${record}@example.invalid`, assigned);
      }
      const read = async (actor = owner, record = lead) => (await tx.$queryRawUnsafe(
        "select workers_comp_workspace($1::uuid,'lead',$2::uuid) as value", actor, record))[0].value;
      const evidence = { kind: 'loss_run', source_name: 'Synthetic employer loss run', source_date: new Date().toISOString().slice(0, 10),
        employer_name: 'Synthetic WC employer', employer_address: '1 Test St, Tucson, AZ', identity: 'confirmed',
        fields: { claim_count: '0', loss_from: '2025-01-01', loss_to: '2025-12-31', loss_completeness: 'complete' }, pages: { claim_count: 2 } };
      const save = async (revision, actor = owner, record = lead, remove = false) => (await tx.$queryRawUnsafe(
        "select workers_comp_workspace($1::uuid,'lead',$2::uuid,$3::uuid,$4::integer,$5::jsonb,$6::boolean) as value",
        actor, record, id, revision, JSON.stringify(evidence), remove))[0].value;
      assert.equal((await read()).entries.length, 0);
      await expected(tx, () => read(outsider), '42501');
      await expected(tx, () => read(agent), '42501');
      const saved = await save(0);
      assert.equal(saved.entries.length, 1);
      assert.equal(saved.entries[0].revision, 1);
      assert.equal(saved.entries[0].evidence.fields.claim_count, '0');
      assert.equal((await read(agent, other)).entries.length, 0, 'Another assigned record does not inherit private data.');
      await expected(tx, () => save(1, agent), '42501');
      await expected(tx, () => save(1, owner, other), 'P0002');
      await expected(tx, () => save(0, agent, other), 'PT409');
      assert.equal((await read()).entries[0].revision, 1);
      await expected(tx, () => save(0), 'PT409');
      assert.equal((await save(1)).entries[0].revision, 2);
      const privilege = await tx.$queryRawUnsafe(`select
        has_table_privilege('authenticated','public.workers_comp_evidence','SELECT') as direct_read,
        has_function_privilege('authenticated','public.workers_comp_workspace(uuid,text,uuid,uuid,integer,jsonb,boolean)','EXECUTE') as invoke`);
      assert.equal(privilege[0].direct_read, false);
      assert.equal(privilege[0].invoke, false);
      assert.equal((await save(2, owner, lead, true)).entries.length, 0);
      const audit = await tx.$queryRawUnsafe("select action,details from agency_audit where target_id=$1::uuid and action like 'workers_comp_%'", lead);
      assert.ok(audit.some((row) => row.action === 'workers_comp_source_removed'));
      assert.ok(audit.every((row) => !JSON.stringify(row.details).includes('claim_count')), 'Audit metadata excludes private values.');
      throw rollback;
    }, { timeout: 90000 });
  } catch (error) {
    if (error !== rollback) throw error;
    console.log('PASS: WC private scope, actor access, stale revisions, no cross-record leakage, audit metadata and removal; all writes rolled back.');
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
