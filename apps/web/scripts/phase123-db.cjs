const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
const mode = process.argv[2];
if (!['--dry-run', '--apply', '--inspect'].includes(mode)) throw new Error('Choose --inspect, --dry-run or --apply. Applying requires explicit database authorization.');
const selectedMigration = process.argv[3];
require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
const url = process.env.TEST_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('A database connection is required.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('DRY_RUN_ROLLBACK');

function statements(sql) {
  const result = [];
  let start = 0, quote = '', dollar = '', line = false, block = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (line) { if (c === '\n') line = false; continue; }
    if (block) {
      if (c === '/' && next === '*') { block++; i++; }
      else if (c === '*' && next === '/') { block--; i++; }
      continue;
    }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) { if (c === quote) { if (next === quote) i++; else quote = ''; } continue; }
    if (c === '-' && next === '-') { line = true; i++; continue; }
    if (c === '/' && next === '*') { block = 1; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '$') {
      const tag = /^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.exec(sql.slice(i));
      if (tag) { dollar = tag[0]; i += dollar.length - 1; continue; }
    }
    if (c === ';') { result.push(sql.slice(start, i).trim()); start = i + 1; }
  }
  result.push(sql.slice(start).trim());
  if (quote || dollar || block) throw new Error('Unterminated SQL statement.');
  return result.filter((statement) => {
    const code = statement.replace(/--[^\n]*/g, '').trim();
    return code && !/^(begin|commit|rollback)$/i.test(code);
  });
}

async function fingerprint(tx) {
  const rows = await tx.$queryRawUnsafe(`select md5(coalesce(string_agg(
    id::text||coalesce(full_name,'')||coalesce(email,'')||coalesce(phone,'')||coalesce(address,''),'|' order by id),''))
    as fingerprint from public.clients`);
  return rows[0].fingerprint;
}

async function main() {
  try {
    const files = fs.readdirSync(path.join(root, 'supabase', 'migrations')).filter((name) => /^\d{14}_/.test(name) && name >= '20261101080000').sort();
    if (selectedMigration && !files.includes(selectedMigration)) throw new Error(`Unknown migration selection: ${selectedMigration}`);
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("set local lock_timeout='5s'");
      await tx.$executeRawUnsafe("set local statement_timeout='60s'");
      await tx.$executeRawUnsafe("select pg_advisory_xact_lock(hashtext('crm-phase123-release'))");
      const history = await tx.$queryRawUnsafe('select version,name from supabase_migrations.schema_migrations');
      assert.ok(history.some((row) => row.version === '20261031110000'), 'The shared workspace baseline must be installed and recorded.');
      const pending = files.filter((file) => (!selectedMigration || file === selectedMigration)
        && !history.some((row) => row.version === file.split('_')[0]));
      console.log('Pending migrations:', pending.join(', ') || 'none');
      if (mode === '--inspect') return;
      const contactFingerprint = await fingerprint(tx);
      const originalIds = {};
      for (const table of ['clients', 'leads', 'tasks', 'interactions', 'client_assets', 'communication_log', 'lead_intake_events', 'policies']) {
        originalIds[table] = (await tx.$queryRawUnsafe(`select id::text from public.${table}`)).map((row) => row.id);
      }
      for (const file of pending) {
        const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', file), 'utf8');
        for (const statement of statements(sql)) await tx.$executeRawUnsafe(statement);
        const [version, ...name] = file.replace(/\.sql$/, '').split('_');
        await tx.$executeRawUnsafe('insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,ARRAY[$3]::text[])',
          version, name.join('_'), sql);
        console.log('Validated migration', file);
      }
      for (const [table, ids] of Object.entries(originalIds)) {
        const rows = await tx.$queryRawUnsafe(`select count(*)::int as amount from public.${table} where id=any($1::uuid[])`, ids);
        assert.equal(rows[0].amount, ids.length, `Original ${table} identities must be preserved.`);
      }
      assert.equal(await fingerprint(tx), contactFingerprint, 'Migration must not overwrite account contact details.');
      const bucket = await tx.$queryRawUnsafe("select public,file_size_limit from storage.buckets where id='account-documents'");
      assert.equal(bucket.length, 1); assert.equal(bucket[0].public, false); assert.equal(Number(bucket[0].file_size_limit), 26214400);
      await tx.$queryRawUnsafe('select id from public.agent_workday limit 1');
      await tx.$queryRawUnsafe('select key from public.conversation_inbox limit 1');
      await tx.$executeRawUnsafe('select public.unread_message_summary()');
      for (const file of ['identity_renewal_reliability.sql', 'calendar-task-reliability.sql', 'agent_workday.sql', 'inbound_action_reliability.sql', 'operational_surfaces.sql', 'internal_action_automation.sql', 'manual_quote_options.sql', 'quote_policy_link.sql', 'policy_insured_asset_schedule.sql', 'outreach_marketing_profiles.sql']) {
        await tx.$executeRawUnsafe('savepoint release_fixture');
        for (const statement of statements(fs.readFileSync(path.join(root, 'supabase', 'tests', file), 'utf8'))) await tx.$executeRawUnsafe(statement);
        await tx.$executeRawUnsafe('rollback to savepoint release_fixture');
        await tx.$executeRawUnsafe('release savepoint release_fixture');
        console.log('PASS rolled-back SQL fixtures', file);
      }
      const manifest = pending.map((file) => `${file}:${createHash('sha256').update(fs.readFileSync(path.join(root, 'supabase', 'migrations', file))).digest('hex')}`).join('\n');
      const receipt = path.join(process.env.TEMP || require('node:os').tmpdir(), 'shield-crm-phase123-dry-run.json');
      if (mode === '--dry-run') {
        fs.writeFileSync(receipt, JSON.stringify({ manifest, database: createHash('sha256').update(url).digest('hex'), at: Date.now() }));
        throw rollback;
      }
      const checked = JSON.parse(fs.readFileSync(receipt, 'utf8'));
      assert.equal(checked.manifest, manifest, 'Migrations changed after dry run; repeat validation.');
      assert.equal(checked.database, createHash('sha256').update(url).digest('hex'), 'Dry run must use the same database.');
      assert.ok(Date.now() - checked.at < 3600000, 'Dry run expired; validate again.');
      console.log('Original records/contact fields preserved. Fixture writes rolled back. Committing approved schema changes only.');
    }, { timeout: 240000, maxWait: 10000 });
    console.log(mode === '--apply' ? 'Approved migrations committed.' : 'Inspection complete.');
  } catch (error) {
    if (error === rollback) console.log('Dry run passed. All database changes rolled back; matching migration manifest recorded for apply.');
    else {
      console.error('Release validation failed:', error.code || error.name, error.meta?.code || '', error instanceof assert.AssertionError ? error.message : error.meta?.message || '');
      process.exitCode = 1;
    }
  } finally { await db.$disconnect(); }
}
void main();
