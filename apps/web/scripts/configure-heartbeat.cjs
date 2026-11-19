const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
require(require.resolve('dotenv', { paths: [path.resolve(__dirname, '..', '..', 'api')] }))
  .config({ path: path.resolve(__dirname, '..', '.env.local') });
const endpoint = 'https://shield-assurance-crm.vercel.app/api/cron/heartbeat';
const secret = process.env.CRON_SECRET?.trim();
const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!secret || !url) throw new Error('Configured database and CRON_SECRET are required.');
const db = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  try {
    const verified = await fetch(endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ verify_only: true }), signal: AbortSignal.timeout(30000),
    });
    if (!verified.ok || (await verified.json()).verify_only !== true) {
      throw new Error(`Live heartbeat authentication was not verified (HTTP ${verified.status}). No credentials or schedules changed.`);
    }
    const owners = await db.$queryRawUnsafe(`select m.user_id from agency_members m join auth.users u on u.id=m.user_id
      where m.active and m.role='owner' and u.email_confirmed_at is not null`);
    const actor = process.argv.find((arg) => arg.startsWith('--owner='))?.slice(8)
      || (owners.length === 1 ? owners[0].user_id : null);
    if (!actor || !owners.some((owner) => owner.user_id === actor)) throw new Error('Specify a verified active owner with --owner=UUID.');
    await db.$transaction(async (tx) => {
      for (const [name, value] of [['crm_heartbeat_endpoint', endpoint], ['crm_heartbeat_authorization', secret]]) {
        const existing = await tx.$queryRawUnsafe('select id::text from vault.secrets where name=$1', name);
        if (existing.length > 1) throw new Error('Heartbeat vault names are ambiguous. No settings changed.');
        if (existing.length) await tx.$executeRawUnsafe('select vault.update_secret($1::uuid,$2)', existing[0].id, value);
        else await tx.$queryRawUnsafe('select vault.create_secret($1,$2)', value, name);
      }
      if (process.argv.includes('--enable')) await tx.$queryRawUnsafe('select public.configure_crm_scheduler($1::uuid,true)', actor);
    });
    console.log('Live heartbeat authentication verified; credentials stored in Vault.');
    console.log(process.argv.includes('--enable') ? 'Background jobs enabled.' : 'Schedules unchanged. Enable them from Settings > Automation & Outreach > Runs.');
  } finally { await db.$disconnect(); }
}
main().catch((error) => {
  console.error(error.code ? `Heartbeat database setup failed (${error.code}). Check Vault permissions and owner selection.`
    : error instanceof Error ? error.message : 'Heartbeat setup failed. No secret values were printed.');
  process.exitCode = 1;
});
