const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');

const root = path.resolve(__dirname, '..', '..', '..');
const useLocal = process.argv.includes('--use-local');
const apply = process.argv.includes('--apply');
if (useLocal) {
  const { config } = require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] }));
  config({ path: path.join(root, 'apps', 'web', '.env.local') });
}
const url = useLocal ? process.env.DIRECT_URL || process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
if (!url) {
  console.error('Set TEST_DATABASE_URL for a prepared test database, or explicitly use --use-local for the configured database. Tests always roll back; --apply commits the migration.');
  process.exit(1);
}
const db = new PrismaClient({ datasources: { db: { url } } });
const version = '20261031110000';
const migration = fs.readFileSync(path.join(root, 'supabase', 'migrations', `${version}_shared_account_workspace.sql`), 'utf8');
const rolledBack = new Error('VALIDATED_ROLLBACK');
const tables = ['leads', 'clients', 'tasks', 'interactions', 'client_assets', 'client_tasks', 'client_activities'];
let phase = 'Connecting';
let appliedThisRun = false;

async function originalIds(tx) {
  const records = new Map();
  for (const table of tables) {
    const rows = await tx.$queryRawUnsafe(`SELECT id::text FROM public.${table}`);
    records.set(table, rows.map(row => row.id));
  }
  return records;
}

async function assertPreserved(tx, originals) {
  for (const [table, ids] of originals) {
    const result = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.${table} WHERE id = ANY($1::uuid[])`, ids);
    assert.equal(result[0].count, ids.length, `The migration must preserve all original ${table} records.`);
  }
}

async function expectSqlError(tx, run, code) {
  await tx.$executeRawUnsafe('SAVEPOINT expected_failure');
  let failure;
  try { await run(); } catch (error) { failure = error; }
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT expected_failure');
  await tx.$executeRawUnsafe('RELEASE SAVEPOINT expected_failure');
  assert.ok(failure, `Expected SQL error ${code}.`);
  assert.equal(failure.meta?.code, code);
}

async function fixtures(tx) {
  phase = 'Testing source timestamp normalization';
  const sourceTimes = await tx.$queryRawUnsafe(`SELECT
    public.workspace_intake_date('{"submitted_at":"2026-10-31 02:00:00+00"}'::jsonb) AS offset_hour,
    public.workspace_intake_date('{"submitted_at":"2026-10-31T02:00:00z"}'::jsonb) AS lower_z,
    public.workspace_intake_date('{"submitted_at":"2026-10-31"}'::jsonb) AS date_only`);
  assert.equal(sourceTimes[0].offset_hour.toISOString(), '2026-10-31T02:00:00.000Z');
  assert.equal(sourceTimes[0].lower_z.toISOString(), '2026-10-31T02:00:00.000Z');
  assert.equal(sourceTimes[0].date_only.toISOString(), '2026-10-31T07:00:00.000Z');
  phase = 'Testing cold imports';
  const imported = randomUUID();
  await tx.$executeRawUnsafe(
    `INSERT INTO public.leads(id,full_name,source,status,form_payload) VALUES($1::uuid,'CRM verification import','prospect_import','new','{"business":"Coverage review test"}'::jsonb)`, imported,
  );
  const importEvents = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.lead_intake_events WHERE lead_id=$1::uuid`, imported);
  assert.equal(importEvents[0].count, 0, 'Cold imports must not appear as website arrivals when channel is absent.');
  const importTasks = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.tasks WHERE related_id=$1::uuid`, imported);
  assert.equal(importTasks[0].count, 0);

  phase = 'Testing submission events';
  const leadId = randomUUID();
  const noteId = randomUUID();
  const prefix = `crm-verification-${randomUUID()}`;
  const firstPayload = { id: `${prefix}-first`, submitted_at: '2026-10-31T02:00:00-07:00', message: 'Business: Test fixtures\nVehicles: Three trucks', profile: { original_import: 'Keep this information' } };
  await tx.$executeRawUnsafe(
    `INSERT INTO public.leads(id,full_name,source,status,form_payload) VALUES($1::uuid,'CRM verification lead','website','new',$2::jsonb)`,
    leadId, JSON.stringify(firstPayload),
  );
  const events = await tx.$queryRawUnsafe(`SELECT * FROM public.lead_intake_events WHERE lead_id=$1::uuid`, leadId);
  assert.equal(events.length, 1);
  assert.equal(events[0].submitted_at.toISOString(), '2026-10-31T09:00:00.000Z');
  const initialTasks = await tx.$queryRawUnsafe(`SELECT subject,due_date FROM public.tasks WHERE intake_event_id=$1::uuid`, events[0].id);
  assert.equal(initialTasks.length, 1);
  assert.match(initialTasks[0].subject, /CRM verification lead.*respond/);
  const initialAlerts = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.notifications WHERE intake_event_id=$1::uuid`, events[0].id);
  assert.equal(initialAlerts[0].count, 1);
  await expectSqlError(tx, () => tx.$queryRawUnsafe(`SELECT public.acknowledge_intake_events($1::uuid[],'opened',$2::uuid)`, [events[0].id, randomUUID()], randomUUID()), 'P0002');
  const notPartiallyOpened = await tx.$queryRawUnsafe(`SELECT opened_at FROM public.lead_intake_events WHERE id=$1::uuid`, events[0].id);
  assert.equal(notPartiallyOpened[0].opened_at, null);
  await tx.$executeRawUnsafe(`SELECT public.create_intake_work($1::uuid)`, events[0].id);
  const dedupTasks = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.tasks WHERE intake_event_id=$1::uuid`, events[0].id);
  assert.equal(dedupTasks[0].count, 1);

  phase = 'Testing atomic notes and reminders';
  const due = new Date(Date.now() - 60000).toISOString();
  const reminder = { subject: 'CRM verification lead: request VIN', due_date: due, priority: 'high' };
  const saveNote = (id, content, reminderValue) => tx.$queryRawUnsafe(
    `SELECT public.save_note_with_reminder($1::uuid,$2::uuid,null,$3,'call',null,'Verification agent',$4::jsonb) AS saved`,
    id, leadId, content, reminderValue === null ? null : JSON.stringify(reminderValue),
  );
  const saved = await saveNote(noteId, 'Client reported three trucks.', reminder);
  assert.equal(saved[0].saved.note.content, 'Client reported three trucks.');
  assert.equal(saved[0].saved.reminder.kind, 'reminder');
  await saveNote(noteId, 'Client reported three trucks.', reminder);
  const noteCount = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.interactions WHERE id=$1::uuid`, noteId);
  assert.equal(noteCount[0].count, 1);
  await expectSqlError(tx, () => saveNote(noteId, 'Client reported three trucks.', { ...reminder, priority: 'low' }), '23505');
  const failedNoteId = randomUUID();
  await expectSqlError(tx, () => saveNote(failedNoteId, 'This note must roll back.', { ...reminder, due_date: 'not-a-date' }), '22007');
  const failedNotes = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.interactions WHERE id=$1::uuid`, failedNoteId);
  assert.equal(failedNotes[0].count, 0, 'An invalid reminder must not leave behind a partially saved note.');
  await expectSqlError(tx, () => tx.$executeRawUnsafe(`DELETE FROM public.leads WHERE id=$1::uuid`, leadId), '23514');

  phase = 'Testing alerts, completion and reopening';
  await tx.$queryRawUnsafe(`SELECT public.dispatch_due_reminders()`);
  await tx.$queryRawUnsafe(`SELECT public.dispatch_due_reminders()`);
  const alerts = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.notifications WHERE task_id=$1::uuid`, noteId);
  assert.equal(alerts[0].count, 1);
  await tx.$executeRawUnsafe(`UPDATE public.tasks SET status='completed' WHERE id=$1::uuid`, noteId);
  const completed = await tx.$queryRawUnsafe(`SELECT completed_at FROM public.tasks WHERE id=$1::uuid`, noteId);
  assert.ok(completed[0].completed_at);
  const readAlerts = await tx.$queryRawUnsafe(`SELECT read FROM public.notifications WHERE task_id=$1::uuid`, noteId);
  assert.ok(readAlerts[0].read);
  await tx.$executeRawUnsafe(`UPDATE public.tasks SET status='open' WHERE id=$1::uuid`, noteId);
  await tx.$queryRawUnsafe(`SELECT public.dispatch_due_reminders()`);
  const reopened = await tx.$queryRawUnsafe(`SELECT completed_at FROM public.tasks WHERE id=$1::uuid`, noteId);
  assert.equal(reopened[0].completed_at, null);
  const reopenedAlerts = await tx.$queryRawUnsafe(`SELECT read FROM public.notifications WHERE task_id=$1::uuid ORDER BY reminder_version`, noteId);
  assert.deepEqual(reopenedAlerts.map(row => row.read), [true, false]);
  await tx.$executeRawUnsafe(`UPDATE public.tasks SET due_date=now()+interval '1 day' WHERE id=$1::uuid`, noteId);
  const unreadOld = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.notifications WHERE task_id=$1::uuid AND NOT read`, noteId);
  assert.equal(unreadOld[0].count, 0);

  phase = 'Testing assets and explicit account ownership';
  const assetIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (let i = 0; i < assetIds.length; i++) {
    await tx.$executeRawUnsafe(
      `INSERT INTO public.client_assets(id,lead_id,title,asset_type,metadata,created_by) VALUES($1::uuid,$2::uuid,$3,$4,$5::jsonb,'Verification agent')`,
      assetIds[i], leadId, i === 3 ? 'Second property' : `Truck ${i + 1}`, i === 3 ? 'property' : 'vehicle',
      JSON.stringify({ details: i === 3 ? { address: '123 Verification Street' } : { make: 'Ford', model: 'F-150' }, source: 'client_reported' }),
    );
  }
  const otherAccount = randomUUID();
  await tx.$executeRawUnsafe(`INSERT INTO public.clients(id,full_name) VALUES($1::uuid,'CRM verification other account')`, otherAccount);
  await expectSqlError(tx, () => tx.$executeRawUnsafe(`UPDATE public.client_assets SET client_id=$1::uuid WHERE id=$2::uuid`, otherAccount, assetIds[0]), '23514');
  const linked = await tx.$queryRawUnsafe(`SELECT public.link_lead_account($1::uuid,null,true) AS id`, leadId);
  const clientId = linked[0].id;
  const linkedAgain = await tx.$queryRawUnsafe(`SELECT public.link_lead_account($1::uuid,null,true) AS id`, leadId);
  assert.equal(linkedAgain[0].id, clientId);
  await expectSqlError(tx, () => tx.$queryRawUnsafe(`SELECT public.link_lead_account($1::uuid,$2::uuid,false)`, leadId, otherAccount), '23514');
  const owned = await tx.$queryRawUnsafe(
    `SELECT (SELECT count(*)::int FROM public.client_assets WHERE client_id=$1::uuid AND lead_id=$2::uuid) AS assets,
      (SELECT client_id FROM public.interactions WHERE id=$3::uuid) AS note_account,
      (SELECT account_id FROM public.tasks WHERE id=$3::uuid) AS task_account`, clientId, leadId, noteId,
  );
  assert.equal(owned[0].assets, 4);
  assert.equal(owned[0].note_account, clientId);
  assert.equal(owned[0].task_account, clientId);
  await tx.$executeRawUnsafe(`UPDATE public.client_assets SET archived_at=clock_timestamp(),updated_by='Verification agent' WHERE id=$1::uuid`, assetIds[0]);
  await tx.$executeRawUnsafe(`UPDATE public.client_assets SET archived_at=null,updated_by='Verification agent' WHERE id=$1::uuid`, assetIds[0]);
  await tx.$executeRawUnsafe(`UPDATE public.interactions SET content='Three trucks; VINs still needed.',updated_by='Verification agent' WHERE id=$1::uuid`, noteId);
  const history = await tx.$queryRawUnsafe(`SELECT metadata FROM public.client_activities WHERE metadata->>'record_id'=$1 AND activity_type='note_updated' ORDER BY occurred_at DESC LIMIT 1`, noteId);
  assert.equal(history[0].metadata.before.content, 'Client reported three trucks.');
  assert.equal(history[0].metadata.after.content, 'Three trucks; VINs still needed.');
  const assetHistory = await tx.$queryRawUnsafe(`SELECT activity_type FROM public.client_activities WHERE metadata->>'record_id'=$1`, assetIds[0]);
  assert.ok(assetHistory.some(row => row.activity_type === 'asset_archived'));
  assert.ok(assetHistory.some(row => row.activity_type === 'asset_restored'));
  const staleTimestamp = saved[0].saved.note.updated_at;
  const staleEdit = await tx.$executeRawUnsafe(`UPDATE public.interactions SET content='Stale overwrite' WHERE id=$1::uuid AND updated_at=$2::timestamptz`, noteId, staleTimestamp);
  assert.equal(staleEdit, 0, 'A stale edit must not overwrite a newer note.');

  phase = 'Testing confirmed identity and snapshot acknowledgment';
  const changes = { full_name: 'Confirmed verification name', email: `${prefix}@example.invalid`, phone: '+15205550100', address: '456 Verification Street' };
  const patched = await tx.$queryRawUnsafe(`SELECT public.patch_lead_profile($1::uuid,$2::jsonb) AS profile`, leadId, JSON.stringify(changes));
  assert.equal(patched[0].profile.full_name, changes.full_name);
  assert.ok(patched[0].profile.confirmed_fields.full_name);
  const account = await tx.$queryRawUnsafe(`SELECT full_name,email,phone,address FROM public.clients WHERE id=$1::uuid`, clientId);
  assert.deepEqual(account[0], changes);
  await tx.$executeRawUnsafe(
    `UPDATE public.leads SET full_name='Legacy submitted alias',email='legacy@example.invalid',phone='+15205550109',
      form_payload=form_payload || '{"legacy_submitter":"older deployed writer"}'::jsonb WHERE id=$1::uuid`, leadId,
  );
  const legacyIdentity = await tx.$queryRawUnsafe(`SELECT full_name,email,phone FROM public.leads WHERE id=$1::uuid`, leadId);
  assert.equal(legacyIdentity[0].full_name, changes.full_name);
  assert.equal(legacyIdentity[0].email, changes.email);
  assert.equal(legacyIdentity[0].phone, changes.phone);
  await expectSqlError(tx, () => tx.$queryRawUnsafe(`SELECT public.patch_lead_profile($1::uuid,'{"account_id":null}'::jsonb)`, leadId), '22023');
  const snapshot = await tx.$queryRawUnsafe(`SELECT public.lead_profile_snapshot($1::uuid) AS profile`, leadId);
  assert.deepEqual(snapshot[0].profile.intake_event_ids, [events[0].id]);
  await tx.$executeRawUnsafe(`UPDATE public.leads SET status='lost' WHERE id=$1::uuid`, leadId);
  const nextPayload = { id: `${prefix}-second`, submitted_at: '2026-10-31T03:00:00-07:00', message: 'Vehicles: Four trucks' };
  const submit = () => tx.$queryRawUnsafe(`SELECT public.apply_website_resubmission($1::uuid,$2::jsonb,'Submitted alias','alias@example.invalid','+15205550101') AS applied`, leadId, JSON.stringify(nextPayload));
  assert.equal((await submit())[0].applied, true);
  assert.equal((await submit())[0].applied, false);
  const current = await tx.$queryRawUnsafe(`SELECT full_name,email,phone,status,form_payload FROM public.leads WHERE id=$1::uuid`, leadId);
  assert.equal(current[0].full_name, changes.full_name);
  assert.equal(current[0].email, changes.email);
  assert.equal(current[0].phone, changes.phone);
  assert.equal(current[0].status, 'new');
  assert.equal(current[0].form_payload.profile.original_import, 'Keep this information');
  assert.equal(current[0].form_payload.previous_submissions.length, 1);
  await tx.$queryRawUnsafe(`SELECT public.acknowledge_intake_events($1::uuid[],'opened',$2::uuid)`, snapshot[0].profile.intake_event_ids, randomUUID());
  const firstAcknowledgment = await tx.$queryRawUnsafe(`SELECT opened_at FROM public.lead_intake_events WHERE id=$1::uuid`, events[0].id);
  await tx.$queryRawUnsafe(`SELECT public.acknowledge_intake_events($1::uuid[],'opened',$2::uuid)`, snapshot[0].profile.intake_event_ids, randomUUID());
  const retriedAcknowledgment = await tx.$queryRawUnsafe(`SELECT opened_at FROM public.lead_intake_events WHERE id=$1::uuid`, events[0].id);
  assert.equal(retriedAcknowledgment[0].opened_at.getTime(), firstAcknowledgment[0].opened_at.getTime());
  const remaining = await tx.$queryRawUnsafe(`SELECT source_submission_id FROM public.lead_intake_events WHERE lead_id=$1::uuid AND opened_at IS NULL AND dismissed_at IS NULL AND handled_at IS NULL`, leadId);
  assert.deepEqual(remaining.map(row => row.source_submission_id), [nextPayload.id], 'Opening the old snapshot must not acknowledge a newer arrival.');

  phase = 'Testing legacy deployed writers';
  const legacyTask = randomUUID();
  const legacyNote = randomUUID();
  await tx.$executeRawUnsafe(`INSERT INTO public.client_tasks(id,client_id,subject,due_date,status,priority) VALUES($1::uuid,$2::uuid,'Legacy task','2026-11-02','open','medium')`, legacyTask, clientId);
  const mirrored = await tx.$queryRawUnsafe(`SELECT due_date,related_type,related_id FROM public.tasks WHERE id=$1::uuid`, legacyTask);
  assert.equal(mirrored[0].due_date.toISOString(), '2026-11-02T23:00:00.000Z');
  assert.equal(mirrored[0].related_type, 'client');
  assert.equal(mirrored[0].related_id, clientId);
  await tx.$executeRawUnsafe(`UPDATE public.client_tasks SET status='completed' WHERE id=$1::uuid`, legacyTask);
  const legacyCompleted = await tx.$queryRawUnsafe(`SELECT completed_at FROM public.tasks WHERE id=$1::uuid`, legacyTask);
  assert.ok(legacyCompleted[0].completed_at);
  await tx.$executeRawUnsafe(`INSERT INTO public.client_assets(id,client_id,title,asset_type,value) VALUES($1::uuid,$2::uuid,'Legacy note','note','Preserve this older note')`, legacyNote, clientId);
  const mirroredNote = await tx.$queryRawUnsafe(`SELECT content FROM public.interactions WHERE id=$1::uuid`, legacyNote);
  assert.equal(mirroredNote[0].content, 'Preserve this older note');

  phase = 'Testing a queue larger than twenty, including older unworked arrivals';
  await tx.$executeRawUnsafe(
    `INSERT INTO public.leads(full_name,source,status,form_payload)
    SELECT 'CRM verification queue ' || n,'website-pull','new',
      jsonb_build_object('id',$1 || '-' || n,'submitted_at',(now()-interval '10 days'+n*interval '1 minute')::text)
    FROM generate_series(1,25) n`, prefix,
  );
  const queue = await tx.$queryRawUnsafe(`SELECT count(*)::int AS count FROM public.lead_intake_events WHERE source_submission_id LIKE $1 AND opened_at IS NULL AND dismissed_at IS NULL AND handled_at IS NULL`, `${prefix}-%`);
  assert.equal(queue[0].count, 26);
  const permissions = await tx.$queryRawUnsafe(
    `SELECT has_function_privilege('authenticated','public.save_note_with_reminder(uuid,uuid,uuid,text,text,uuid,text,jsonb)','EXECUTE') AS allowed`,
  );
  assert.equal(permissions[0].allowed, false);
  console.log('Database workflows passed: cold-import filtering, durable arrivals, atomic saves, reminder alerts, complete/reopen, ownership, multiple assets, audit history, confirmed identity, snapshot acknowledgment and legacy mirroring.');
}

async function main() {
  try {
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('crm-shared-account-workspace'))::text`);
      const schema = await tx.$queryRawUnsafe(`SELECT to_regclass('public.lead_intake_events') IS NOT NULL AS installed`);
      if (!schema[0].installed) {
        phase = 'Checking original records and applying migration SQL';
        const originals = await originalIds(tx);
        await tx.$executeRawUnsafe(migration);
        await assertPreserved(tx, originals);
        console.log(`Original records preserved: ${[...originals].map(([table, ids]) => `${table}=${ids.length}`).join(', ')}.`);
        if (apply) {
          phase = 'Recording the Supabase migration version';
          await tx.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS supabase_migrations');
          await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version varchar PRIMARY KEY, statements text[], name text)');
          const columns = await tx.$queryRawUnsafe(`SELECT column_name FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'`);
          assert.ok(['version', 'statements', 'name'].every(name => columns.some(row => row.column_name === name)), 'Unrecognized migration history schema.');
          await tx.$executeRawUnsafe(`INSERT INTO supabase_migrations.schema_migrations(version,statements,name) VALUES($1,ARRAY[$2]::text[],'shared_account_workspace')`, version, migration);
          appliedThisRun = true;
          return;
        }
      } else if (apply) {
        const tracked = await tx.$queryRawUnsafe(`SELECT version FROM supabase_migrations.schema_migrations WHERE version=$1`, version);
        assert.equal(tracked.length, 1, 'The installed workspace schema must have its migration version recorded.');
        console.log('The workspace migration is already applied and recorded.');
        return;
      }
      await fixtures(tx);
      throw rolledBack;
    }, { timeout: 180000, maxWait: 10000 });
    if (apply) {
      if (appliedThisRun) console.log('Approved migration and version record committed; no verification records were committed.');
      try {
        await db.$transaction(async tx => { await fixtures(tx); throw rolledBack; }, { timeout: 120000, maxWait: 10000 });
      } catch (error) {
        if (error !== rolledBack) throw error;
        console.log('Post-application verification records rolled back.');
      }
      const job = await db.$queryRawUnsafe(`SELECT schedule,active FROM cron.job WHERE jobname='crm-due-reminders'`);
      assert.equal(job.length, 1);
      assert.equal(job[0].schedule, '* * * * *');
      assert.ok(job[0].active);
      console.log('The one-minute reminder dispatcher is active.');
    }
  } catch (error) {
    if (error === rolledBack) console.log('Validation complete. All migration/test changes rolled back.');
    else {
      console.error(`Failed during "${phase}": ${error.code || error.name}${error.meta?.code ? ` (SQL ${error.meta.code})` : ''}.`);
      if (error.name === 'AssertionError') console.error(error.message);
      process.exitCode = 1;
    }
  } finally { await db.$disconnect(); }
}
void main();
