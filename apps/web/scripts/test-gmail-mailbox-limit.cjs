const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..', '..', '..');
require(require.resolve('dotenv', { paths: [path.join(root, 'apps', 'api')] })).config({ path: path.join(root, 'apps', 'web', '.env.local') });
const url = process.env.TEST_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error('A database connection is required.');
const db = new PrismaClient({ datasources: { db: { url } } });
const actor = randomUUID();
const email = `concurrent-limit-${actor}@example.invalid`;
let connection;
async function reserve(tx) {
  const id = randomUUID();
  await tx.$executeRaw`insert into public.agent_email_attempts
    (id,user_id,connection_id,to_email,subject,body,content_hash,rfc_message_id,status)
    values(${id}::uuid,${actor}::uuid,${connection}::uuid,${email},'Fixture','Fixture',${id},${`<${id}@example.invalid>`},'recorded')`;
}
async function run() {
  try {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`insert into auth.users(id,email,email_confirmed_at) values(${actor}::uuid,${email},now())`;
      await tx.$executeRaw`insert into public.agency_members(user_id,email,role,active) values(${actor}::uuid,${email},'agent',true)`;
      const rows = await tx.$queryRaw`select public.connect_personal_gmail(${actor}::uuid,${email},'fixture','fixture',now()) as id`;
      connection = rows[0].id;
      for (let i = 0; i < 49; i++) await reserve(tx);
    }, { timeout: 30000 });
    let release;
    const claimed = new Promise((resolve) => { release = resolve; });
    const first = db.$transaction(async (tx) => {
      await reserve(tx);
      release();
      await tx.$queryRaw`select pg_sleep(0.5)::text`;
    }).catch((error) => { release(); throw error; });
    await claimed;
    const results = await Promise.allSettled([first, db.$transaction(reserve)]);
    assert.equal(results[0].status, 'fulfilled', '50th reservation must succeed');
    assert.equal(results[1].status, 'rejected', 'Concurrent 51st reservation must fail');
    assert.equal(results[1].reason.meta?.code, 'PT429');
    const counts = await db.$queryRaw`select count(*)::integer as total from public.agent_email_attempts where connection_id=${connection}::uuid`;
    assert.equal(counts[0].total, 50);
    console.log('PASS: 49 existing reservations plus two concurrent claims produce exactly 50; overflow is PT429.');
  } finally {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`delete from public.agent_email_attempts where user_id=${actor}::uuid`;
      await tx.$executeRaw`delete from public.gmail_connections where user_id=${actor}::uuid`;
      await tx.$executeRaw`delete from public.agency_members where user_id=${actor}::uuid`;
      await tx.$executeRaw`delete from public.agency_audit where actor_id=${actor}::uuid`;
      await tx.$executeRaw`delete from auth.users where id=${actor}::uuid`;
    });
    await db.$disconnect();
  }
}
run().catch((error) => {
  console.error('Mailbox concurrency validation failed:', error.code ?? '', error.meta?.code ?? '', error.message);
  process.exitCode = 1;
});
