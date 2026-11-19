const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
if (process.argv.includes('--use-local')) {
  require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
}
const url = process.argv.includes('--use-local') ? process.env.DIRECT_URL || process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Set TEST_DATABASE_URL or explicitly use --use-local. All schema and fixture writes always roll back.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('VERIFIED_ROLLBACK');
async function expectedError(tx, work, code) {
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
      const installed = await tx.$queryRawUnsafe("select to_regclass('public.carrier_appetite_documents')::text as name");
      if (!installed[0].name) {
        const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261111010000_carrier_appetite.sql'), 'utf8')
          .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
        await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${sql}$migration$; END $verify$;`);
      }
      const uploadSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261112193000_carrier_appetite_upload_without_proof.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${uploadSql}$migration$; END $verify$;`);
      const guideSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261112223000_carrier_appetite_guide_activation.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      await tx.$executeRawUnsafe(guideSql);
      const aiSql = fs.readFileSync(path.join(root, 'supabase', 'migrations', '20261113001000_carrier_appetite_ai_readings.sql'), 'utf8')
        .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
      await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${aiSql}$migration$; END $verify$;`);
      const owners = await tx.$queryRawUnsafe("select user_id from agency_members where active and role='owner' limit 1");
      assert.equal(owners.length, 1, 'An active owner is required for rollback verification.');
      const owner = owners[0].user_id, outsider = randomUUID(), id = randomUUID();
      const call = async (actor, document, revision, action, input = {}) => {
        const rows = await tx.$queryRawUnsafe('select public.save_carrier_appetite($1::uuid,$2::uuid,$3::integer,$4::text,$5::jsonb) as saved',
          actor, document, revision, action, JSON.stringify(input));
        return rows[0].saved;
      };
      const reserve = { file_name: 'synthetic.txt', file_size: 50, content_type: 'text/plain', storage_path: `carrier-appetite/${id}/synthetic.txt` };
      await expectedError(tx, () => call(outsider, id, 0, 'reserve', reserve), '42501');
      await call(owner, id, 0, 'reserve', reserve);
      const values = { carrier: `Rollback Carrier ${id}`, title: 'Synthetic guide',
        line: 'General liability', states: 'AZ', effective_on: '2026-01-01', expires_on: '', access: 'direct',
        rules: [{ id: randomUUID(), criterion: 'Restaurants', decision: 'eligible', page: 1, excerpt: 'Restaurants' }] };
      const input = { pages: [{ page: 1, text: 'ELIGIBLE CLASSES\nRestaurants' }], values };
      let saved = await call(owner, id, 0, 'save', input);
      assert.equal(saved.revision, 1);
      assert.equal((await call(owner, id, 0, 'save', input)).revision, 1, 'Lost save response retries must not duplicate revisions');
      await expectedError(tx, () => call(outsider, id, 1, 'activate'), '42501');
      const bad = structuredClone(input); bad.values.rules[0].excerpt = 'Fabricated rule';
      await expectedError(tx, () => call(owner, id, 1, 'save', bad), '22023');
      const mixed = structuredClone(input); mixed.values.rules[0].carrier = 'Another carrier';
      await expectedError(tx, () => call(owner, id, 1, 'save', mixed), '22023');
      saved = await call(owner, id, 1, 'activate');
      assert.equal(saved.state, 'active');
      assert.equal(saved.approved_by, owner);
      assert.equal((await call(owner, id, 1, 'activate')).revision, 2);
      const changed = structuredClone(input); changed.values.title = 'Revised title';
      saved = await call(owner, id, 2, 'save', changed);
      assert.equal(saved.state, 'draft'); assert.equal(saved.approved_by, null);
      await expectedError(tx, () => call(owner, id, 2, 'activate'), 'PT409');
      const modifiedSource = structuredClone(changed); modifiedSource.pages[0].text += '\nInjected source';
      await expectedError(tx, () => call(owner, id, 3, 'save', modifiedSource), 'PT409');
      const ambiguous = structuredClone(changed); ambiguous.values.rules[0].decision = 'needs_review';
      ambiguous.values.effective_on = ''; ambiguous.values.expires_on = ''; ambiguous.values.line = ''; ambiguous.values.states = '';
      await call(owner, id, 3, 'save', ambiguous);
      saved = await call(owner, id, 4, 'activate');
      assert.equal(saved.state, 'active', 'Undated guides and unresolved entries must not block activation');
      const second = randomUUID();
      await call(owner, second, 0, 'reserve', { ...reserve, storage_path: `carrier-appetite/${second}/synthetic.txt` });
      await call(owner, second, 0, 'save', input); await call(owner, second, 1, 'activate');
      await call(owner, id, 5, 'save', changed); await call(owner, id, 6, 'activate');
      const overlap = await tx.$queryRawUnsafe('select public.carrier_appetite_source_overlaps() as ids');
      assert.ok(overlap[0].ids.includes(id) && overlap[0].ids.includes(second));
      await call(owner, second, 2, 'withdraw');
      const withdrawn = await tx.$queryRawUnsafe('select public.carrier_appetite_source_overlaps() as ids');
      assert.ok(!withdrawn[0].ids.includes(id));
      const unclearId = randomUUID();
      await call(owner, unclearId, 0, 'reserve', { ...reserve, storage_path: `carrier-appetite/${unclearId}/synthetic.txt` });
      const unclear = { ...input, values: { ...values, carrier: `Unclear ${unclearId}`, rules: [],
        unresolved_entries: [{ criterion: 'Unmatched restriction', page: 1, reason: 'Source text could not be matched.' }] } };
      await call(owner, unclearId, 0, 'save', unclear);
      const enabled = await call(owner, unclearId, 1, 'activate');
      assert.equal(enabled.state, 'active');
      assert.equal(enabled.values.rules.length, 0);
      assert.deepEqual(enabled.values.unresolved_entries, unclear.values.unresolved_entries);
      const history = await tx.$queryRawUnsafe('select snapshot from carrier_appetite_revisions where document_id=$1::uuid order by revision', id);
      assert.equal(history.length, 7);
      assert.equal(history[1].snapshot.values.title, 'Synthetic guide');
      const property = structuredClone(changed.values);
      property.line = 'Commercial property';
      const apply = (actor, document, revision, values) => tx.$queryRawUnsafe(
        'select public.apply_carrier_appetite_reading($1::uuid,$2::uuid,$3::integer,$4::jsonb) as saved',
        actor, document, revision, JSON.stringify(values));
      await expectedError(tx, () => apply(outsider, id, 7, property), '42501');
      const aiProperty = await apply(owner, id, 7, property);
      assert.equal(aiProperty[0].saved.state, 'active', 'Replacing a saved AI reading preserves active state atomically');
      assert.equal(aiProperty[0].saved.revision, 9);
      assert.deepEqual(aiProperty[0].saved.pages, input.pages);
      const auto = structuredClone(input); auto.values.line = 'Commercial auto';
      await call(owner, second, 3, 'save', auto); await call(owner, second, 4, 'activate');
      const separated = await tx.$queryRawUnsafe('select public.carrier_appetite_source_overlaps() as ids');
      assert.ok(!separated[0].ids.includes(id) && !separated[0].ids.includes(second), 'Auto and property are independent programs');
      const hash = 'a'.repeat(64);
      await tx.$executeRawUnsafe("insert into carrier_appetite_ai_readings(source_hash,reader_version,state) values($1,'synthetic-rollback','processing')", hash);
      await expectedError(tx, () => tx.$executeRawUnsafe("insert into carrier_appetite_ai_readings(source_hash,reader_version,state) values($1,'synthetic-rollback','processing')", hash), '23505');
      await tx.$executeRawUnsafe("update carrier_appetite_ai_readings set state='complete',reading=$1::jsonb where source_hash=$2 and reader_version='synthetic-rollback'", JSON.stringify(property), hash);
      const cache = await tx.$queryRawUnsafe("select reading from carrier_appetite_ai_readings where source_hash=$1 and reader_version='synthetic-rollback'", hash);
      assert.deepEqual(cache[0].reading, property);
      const privileges = await tx.$queryRawUnsafe(`select
        has_table_privilege('authenticated','public.carrier_appetite_documents','SELECT') as client_read,
        has_table_privilege('service_role','public.carrier_appetite_documents','UPDATE') as direct_write,
        has_function_privilege('authenticated','public.save_carrier_appetite(uuid,uuid,integer,text,jsonb)','EXECUTE') as client_execute,
        has_table_privilege('authenticated','public.carrier_appetite_ai_readings','SELECT') as client_ai_read,
        has_function_privilege('authenticated','public.apply_carrier_appetite_reading(uuid,uuid,integer,jsonb)','EXECUTE') as client_ai_execute`);
      assert.deepEqual(privileges[0], { client_read: false, direct_write: false, client_execute: false, client_ai_read: false, client_ai_execute: false });
      console.log('Carrier appetite SQL verified: exact revisions, approval invalidation, evidence, immutable sources, retries, carrier overlaps, withdrawal, history and permissions. Rolling back all writes.');
      throw rollback;
    }, { timeout: 120000 });
  } catch (error) { if (error !== rollback) throw error; }
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
