const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
const local = process.argv.includes('--use-local');
if (local) {
  require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] }))
    .config({ path: path.join(root, 'apps', 'web', '.env.local') });
}
const url = local ? process.env.DIRECT_URL || process.env.DATABASE_URL : process.env.TEST_DATABASE_URL;
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
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout='5s'");
      for (const [table, migration] of [
        ['record_contact_preferences', '20261113015000_record_contact_preferences.sql'],
        ['prospecting_cadences', '20261113020000_prospecting_cadence.sql'],
      ]) {
        const installed = await tx.$queryRawUnsafe('select to_regclass($1)::text as name', `public.${table}`);
        if (!installed[0].name) {
          const sql = fs.readFileSync(path.join(root, 'supabase', 'migrations', migration), 'utf8')
            .replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '');
          await tx.$executeRawUnsafe(`DO $verify$ BEGIN EXECUTE $migration$${sql}$migration$; END $verify$;`);
        }
      }
      const owners = await tx.$queryRawUnsafe("select user_id from agency_members where active and role='owner' limit 1");
      assert.equal(owners.length, 1, 'An active owner is required for rollback verification.');
      const owner = owners[0].user_id;
      const start = async () => {
        const id = randomUUID();
        await tx.$executeRawUnsafe(`insert into leads(id,full_name,email,source,status)
          values($1::uuid,'Synthetic prospecting verification',$2,'prospect_import','new')`, id, `${id}@example.invalid`);
        const now = new Date();
        const days = [0, 1, 3, 6, 8, 11, 15, 20];
        const touches = days.map((day, index) => ({
          touch_number: index + 1,
          channel: [0, 2, 4, 7].includes(index) ? 'call' : 'email',
          due_at: new Date(now.getTime() + day * 86400000 - 60000).toISOString(),
        }));
        const rows = await tx.$queryRawUnsafe('select create_prospecting_cadence($1::uuid,$2::uuid,null,$3::jsonb) as id',
          owner, id, JSON.stringify(touches));
        return { lead: id, cadence: rows[0].id, email: `${id}@example.invalid`, touches };
      };
      const rows = async (fixture) => tx.$queryRawUnsafe(
        'select * from prospecting_cadence_touches where cadence_id=$1::uuid order by touch_number', fixture.cadence);
      const state = async (fixture) => (await tx.$queryRawUnsafe(
        'select * from prospecting_cadences where id=$1::uuid', fixture.cadence))[0];

      const fixture = await start();
      const touches = await rows(fixture);
      assert.equal(touches.length, 8);
      assert.deepEqual(touches.map((touch) => touch.channel), ['call', 'email', 'call', 'email', 'call', 'email', 'email', 'call']);
      const tasks = await tx.$queryRawUnsafe(`select t.* from tasks t join prospecting_cadence_touches p on p.task_id=t.id
        where p.cadence_id=$1::uuid`, fixture.cadence);
      assert.equal(tasks.length, 4);
      await expectedError(tx, () => tx.$executeRawUnsafe("insert into sequence_enrollments(lead_id) values($1::uuid)", fixture.lead), '22023');
      assert.ok(tasks.every((task) => task.assignee && task.action_href.includes(fixture.lead)));
      assert.equal(tasks[0].due_date.getUTCHours(), new Date(fixture.touches[0].due_at).getUTCHours(), 'Call tasks preserve their due time.');
      await expectedError(tx, () => tx.$queryRawUnsafe('select create_prospecting_cadence($1::uuid,$2::uuid,null,$3::jsonb)',
        owner, fixture.lead, JSON.stringify(fixture.touches)), '23505');
      await expectedError(tx, () => tx.$queryRawUnsafe('select complete_prospecting_call_touch($1::uuid,$2::uuid,$3)',
        randomUUID(), touches[0].id, 'connected'), '42501');
      for (const touch of touches.filter((touch) => touch.channel === 'call').slice(0, 3)) {
        await tx.$executeRawUnsafe("update prospecting_cadence_touches set due_at=now()-interval '1 minute' where id=$1::uuid", touch.id);
      }
      for (const touch of [touches[0], touches[2]]) {
        await tx.$executeRawUnsafe("select complete_prospecting_call_touch($1::uuid,$2::uuid,'voicemail')", owner, touch.id);
      }
      assert.equal((await state(fixture)).voicemail_count, 2);
      await expectedError(tx, () => tx.$queryRawUnsafe("select complete_prospecting_call_touch($1::uuid,$2::uuid,'voicemail')",
        owner, touches[4].id), '22023');

      const draft = async (touch, email) => (await tx.$queryRawUnsafe(
        `select create_prospecting_email_draft($1::uuid,$2,'A specific business review','Synthetic review draft','["Synthetic documented fact"]'::jsonb) as created`,
        touch.id, email))[0].created;
      assert.equal(await draft(touches[1], fixture.email), false, 'Future email steps are not drafted early.');
      await tx.$executeRawUnsafe("update prospecting_cadence_touches set due_at=now()-interval '1 minute' where id=$1::uuid", touches[1].id);
      assert.equal(await draft(touches[1], fixture.email), true);
      assert.equal(await draft(touches[1], fixture.email), false, 'Retries cannot create duplicate drafts.');
      const outbox = (await tx.$queryRawUnsafe('select * from outreach_outbox where prospecting_touch_id=$1::uuid', touches[1].id))[0];
      assert.equal(outbox.status, 'pending_approval');
      assert.equal(outbox.requires_manual_approval, true);
      assert.equal(outbox.agent_user_id, owner);
      assert.equal((await tx.$queryRawUnsafe("select claim_outreach_send($1::uuid,'Subject','Body',null) as claimed", outbox.id))[0].claimed, false,
        'Automatic sends cannot claim a prospecting draft.');

      await tx.$executeRawUnsafe("update outreach_outbox set status='accepted_by_provider',provider='verification',sent_at=now() where id=$1::uuid", outbox.id);
      assert.equal((await tx.$queryRawUnsafe('select finalize_outreach_send($1::uuid,now()) as saved', outbox.id))[0].saved, true);
      assert.equal((await rows(fixture))[1].outcome, 'email_sent', 'Provider acceptance completes the planned email touch.');
      await tx.$executeRawUnsafe("select set_record_contact_preference($1::uuid,'lead',$2::uuid,true,'Synthetic test')", owner, fixture.lead);
      assert.equal((await state(fixture)).status, 'do_not_contact');
      assert.ok((await rows(fixture)).filter((touch) => touch.completed_at === null).every((touch) => touch.status === 'cancelled'));
      const openCalls = await tx.$queryRawUnsafe(`select count(*)::int as count from tasks t
        join prospecting_cadence_touches p on p.task_id=t.id where p.cadence_id=$1::uuid and t.status='open'`, fixture.cadence);
      assert.equal(openCalls[0].count, 0);
      assert.equal((await tx.$queryRawUnsafe('select * from lead_contact_restrictions(array[$1::uuid])', fixture.lead))[0].do_not_contact, true);

      const nurture = await start();
      const reminder = async () => (await tx.$queryRawUnsafe("select create_prospecting_nurture($1::uuid,$2::uuid,(now()+interval '60 days')::date) as id",
        owner, nurture.lead))[0].id;
      assert.equal(await reminder(), await reminder(), 'The same reminder is saved only once.');
      await tx.$executeRawUnsafe("select set_record_contact_preference($1::uuid,'lead',$2::uuid,true,'Synthetic test')", owner, nurture.lead);
      const reminders = await tx.$queryRawUnsafe("select count(*)::int as count from tasks where related_id=$1::uuid and action_category='prospecting_nurture' and status='open'", nurture.lead);
      assert.equal(reminders[0].count, 0, 'Do Not Contact cancels future prospecting nurture tasks too.');

      const connected = await start();
      await tx.$executeRawUnsafe("select complete_prospecting_call_touch($1::uuid,$2::uuid,'connected')", owner, (await rows(connected))[0].id);
      assert.equal((await state(connected)).status, 'replied', 'A connected call moves the plan to personal follow-up.');

      const reply = await start();
      await tx.$queryRawUnsafe("select process_outreach_reply(null,$1,null,'Thanks, please call me.',null)", reply.email);
      assert.equal((await state(reply)).status, 'replied');
      const followups = await tx.$queryRawUnsafe("select count(*)::int as count from tasks where inbound_reply_key=$1", `prospecting-reply:${reply.cadence}`);
      assert.equal(followups[0].count, 1);
      const exited = await start();
      await tx.$executeRawUnsafe("update leads set status='quoted' where id=$1::uuid", exited.lead);
      assert.equal((await state(exited)).status, 'pipeline_exit');
      const lateReply = await start();
      const lateTouch = (await rows(lateReply))[1];
      await tx.$executeRawUnsafe("update prospecting_cadence_touches set due_at=now()-interval '1 minute' where id=$1::uuid", lateTouch.id);
      await tx.$executeRawUnsafe(`insert into communication_log(channel,direction,body,sent_at,metadata)
        values('email','inbound','Synthetic late reply',now()+interval '1 second',jsonb_build_object('lead_id',$1::text))`, lateReply.lead);
      assert.equal(await draft(lateTouch, lateReply.email), false, 'A reply during AI generation cannot leave a sendable draft.');
      assert.equal((await state(lateReply)).status, 'replied');
      const declined = await start();
      await tx.$queryRawUnsafe("select process_outreach_reply(null,$1,null,'unsubscribe',null)", declined.email);
      assert.equal((await state(declined)).status, 'do_not_contact');
      const cancellation = await start();
      await tx.$executeRawUnsafe("select stop_prospecting_cadence($1::uuid,'cancelled','Synthetic cancellation')", cancellation.cadence);
      assert.equal((await state(cancellation)).status, 'cancelled');
      console.log('Verified eight-touch scheduling, assigned manual tasks, two-voicemail cap, due-only/idempotent approval drafts, acceptance bookkeeping, DNC, replies, opt-outs, pipeline exit and cancellation.');
      throw rollback;
    }, { timeout: 90000, maxWait: 10000 });
  } catch (error) {
    if (error !== rollback) throw error;
    console.log('All schema and fixture changes rolled back; no messages sent.');
  } finally { await db.$disconnect(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
