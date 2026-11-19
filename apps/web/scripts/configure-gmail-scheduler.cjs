const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
require(require.resolve('dotenv', { paths: [path.resolve(__dirname, '..', '..', 'api')] }))
  .config({ path: path.resolve(__dirname, '..', '.env.local'), quiet: true });
const enable = process.argv.includes('--enable');
const pause = process.argv.includes('--pause');
if (enable === pause) throw new Error('Choose exactly one of --enable or --pause.');
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('A configured database connection is required.');
const db = new PrismaClient({ datasources: { db: { url } } });
const endpoint = 'https://shield-assurance-crm.vercel.app/api/cron/heartbeat';

async function main() {
  try {
    const owners = await db.$queryRawUnsafe(`select m.user_id from agency_members m join auth.users u on u.id=m.user_id
      where m.active and m.role='owner' and u.email_confirmed_at is not null
      and u.email not like '%@example.invalid' and coalesce(u.raw_user_meta_data->>'crm_browser_qa','false')<>'true'`);
    const actor = process.argv.find((arg) => arg.startsWith('--owner='))?.slice(8)
      || (owners.length === 1 ? owners[0].user_id : null);
    if (!actor || !owners.some((owner) => owner.user_id === actor)) throw new Error('Specify a verified active owner with --owner=UUID.');
    const secrets = await db.$queryRawUnsafe(`select name,decrypted_secret from vault.decrypted_secrets
      where name in ('crm_heartbeat_endpoint','crm_heartbeat_authorization')`);
    const secret = secrets.find((row) => row.name === 'crm_heartbeat_authorization')?.decrypted_secret;
    if (secrets.length !== 2 || secrets.find((row) => row.name === 'crm_heartbeat_endpoint')?.decrypted_secret !== endpoint || !secret) {
      throw new Error('Canonical heartbeat credentials are not configured. No scheduling changed.');
    }
    const verified = await fetch(endpoint, { method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ verify_only: true }), signal: AbortSignal.timeout(30000) });
    if (!verified.ok || (await verified.json()).verify_only !== true) throw new Error('Canonical heartbeat authentication failed. No scheduling changed.');
    if (process.argv.includes('--empty-queue-only')) {
      const counts = await db.$queryRawUnsafe(`select
        (select count(*)::integer from gmail_connections where status='connected') as mailboxes,
        (select count(*)::integer from scheduled_messages where gmail_connection_id is not null and status in ('pending','processing')) as schedules,
        (select count(*)::integer from sequence_enrollments where gmail_connection_id is not null and status='active') as sequences`);
      if (Object.values(counts[0]).some((value) => value !== 0)) throw new Error('Empty-mailbox activation check failed. No scheduling changed and no job was run.');
    }
    await db.$transaction(async (tx) => {
      const before = await tx.$queryRawUnsafe("select jobname,active from cron.job where jobname in ('crm-due-reminders','crm-web-heartbeat') order by jobname");
      await tx.$queryRawUnsafe('select public.configure_personal_gmail_scheduler($1::uuid,$2::boolean)', actor, enable);
      const after = await tx.$queryRawUnsafe("select jobname,active from cron.job where jobname in ('crm-due-reminders','crm-web-heartbeat') order by jobname");
      if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Broader scheduler state changed unexpectedly. Gmail activation rolled back.');
    });
    const jobs = await db.$queryRawUnsafe("select jobname,schedule,active from cron.job where jobname in ('crm-personal-gmail','crm-due-reminders','crm-web-heartbeat') order by jobname");
    const gmail = jobs.find((job) => job.jobname === 'crm-personal-gmail');
    if (!gmail || gmail.active !== enable) throw new Error('Gmail scheduler state could not be confirmed.');
    console.log('Canonical authentication verified. Personal Gmail scheduler:', enable ? 'enabled' : 'paused');
    console.log(JSON.stringify(jobs));
  } finally { await db.$disconnect(); }
}
main().catch((error) => {
  console.error(error.code ? `Gmail scheduler configuration failed (${error.code}). No secret values were printed.` : error.message);
  process.exitCode = 1;
});
