const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { createClient } = require('@supabase/supabase-js');
const run = promisify(execFile);
const hash = (value) => createHash('sha256').update(value).digest('hex');

async function main() {
  if (!process.argv.includes('--approved-synthetic-test')) throw new Error('Use --approved-synthetic-test only on the configured private worker; creates and removes synthetic fixtures.');
  process.loadEnvFile(path.resolve(__dirname, '..', '.env.local'));
  const home = path.join(process.env.LOCALAPPDATA, 'ShieldAssurance', 'SecureIntake');
  const settings = JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(settings.oracleEnabled, false);
  const db = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
  });
  const actor = randomUUID(), templateId = randomUUID(), requestId = randomUUID(), question = randomUUID();
  const env = {
    ...process.env, CRM_PROSPECT_SCANNER_APPROVED: 'true', CRM_PROSPECT_CLEANUP_APPROVED: 'true',
    PROSPECT_CLAMSCAN_PATH: path.join(settings.bin, 'clamscan.exe'), PROSPECT_CLAMAV_DATABASE: path.join(home, 'database'),
    TEMP: path.join(home, 'temp'), TMP: path.join(home, 'temp'), TMPDIR: path.join(home, 'temp'),
  };
  const staff = async (action, data) => (await db.$queryRawUnsafe(
    'select prospect_questionnaire_staff($1::uuid,$2,$3::jsonb) as value', actor, action, JSON.stringify(data)))[0].value;
  const token = randomUUID(), session = hash(randomUUID());
  const publicAction = async (action, data) => (await db.$queryRawUnsafe(
    'select prospect_questionnaire_public($1,$2,$3::jsonb) as value', hash(token), action, JSON.stringify(data)))[0].value;
  const uploaded = [];
  let leadId;
  try {
    const pdfs = JSON.parse((await run('python', ['-c', [
      'from pypdf import PdfWriter',
      'from io import BytesIO',
      'import base64,json',
      'def make(encrypted=False,attachment=False):',
      ' w=PdfWriter();w.add_blank_page(width=100,height=100)',
      ' if encrypted:w.encrypt("synthetic-test-password")',
      ' if attachment:w.add_attachment("antivirus-test.txt",base64.b64decode("WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo="))',
      ' out=BytesIO();w.write(out);return base64.b64encode(out.getvalue()).decode()',
      'print(json.dumps({"clean":make(),"encrypted":make(True),"antivirus":make(attachment=True)}))',
    ].join('\n')], { timeout: 30000 })).stdout);
    await db.$executeRawUnsafe('insert into auth.users(id,email) values($1::uuid,$2)', actor, `local-intake-${actor}@example.invalid`);
    await db.$executeRawUnsafe("insert into agency_members(user_id,email,role,active) values($1::uuid,$2,'agent',true)", actor, `local-intake-${actor}@example.invalid`);
    const design = { name: 'Synthetic local worker QA', questions: [{ id: question, label: 'Synthetic documents', type: 'file', required: true, options: [], field: '' }] };
    await staff('save_template', { id: templateId, expected: 0, design });
    await staff('create_request', { id: requestId, template_id: templateId, design, recipient: `qa-${requestId}@example.invalid`,
      recipient_name: 'Synthetic worker QA', token_hash: hash(token), expires_at: new Date(Date.now() + 3600000).toISOString() });
    await publicAction('challenge', { code_hash: hash('synthetic-code'), network: hash('synthetic-network'), contact: { first_name: 'Synthetic', last_name: 'Worker' } });
    assert.equal((await publicAction('verify', { code_hash: hash('synthetic-code'), new_session: session })).verified, true);
    await run(process.execPath, [path.join(__dirname, 'scan-prospect-documents.cjs')], { env, timeout: 120000 });
    await run(process.execPath, [path.join(__dirname, 'cleanup-prospect-documents.cjs')], { env, timeout: 120000 });
    for (const [kind, base64] of Object.entries(pdfs)) {
      const bytes = Buffer.from(base64, 'base64');
      const file = await publicAction('upload', { session_hash: session, id: randomUUID(), question_id: question,
        name: `${kind}.pdf`, size: bytes.length, type: 'application/pdf' });
      uploaded.push(file.storage_path);
      const ticket = await storage.storage.from('prospect-documents').createSignedUploadUrl(file.storage_path, { upsert: false });
      if (ticket.error) throw new Error(`Synthetic upload ticket failed (${ticket.error.statusCode}).`);
      const put = await storage.storage.from('prospect-documents').uploadToSignedUrl(file.storage_path, ticket.data.token, bytes, { contentType: 'application/pdf' });
      if (put.error) throw new Error(`Synthetic private upload failed (${put.error.statusCode}).`);
    }
    await db.$executeRawUnsafe("update prospect_questionnaire_files set created_at=now()-interval '1 minute' where request_id=$1::uuid", requestId);
    await run(process.execPath, [path.join(__dirname, 'scan-prospect-documents.cjs')], { env, timeout: 360000 });
    const verdicts = await db.$queryRawUnsafe('select id,name,state,digest from prospect_questionnaire_files where request_id=$1::uuid', requestId);
    for (const [name, state] of [['clean.pdf', 'clean'], ['encrypted.pdf', 'blocked'], ['antivirus.pdf', 'blocked']]) {
      assert.equal(verdicts.find((file) => file.name === name)?.state, state, `Real scanner verdict for ${name}`);
    }
    assert.equal((await publicAction('submit', { session_hash: session, consent: true, answers: {} })).submitted, true);
    leadId = (await db.$queryRawUnsafe('select target_id from prospect_questionnaire_requests where id=$1::uuid', requestId))[0].target_id;
    const clean = verdicts.find((file) => file.name === 'clean.pdf');
    const authorized = await staff('file', { id: requestId, file_id: clean.id });
    const download = await storage.storage.from('prospect-documents').download(authorized.storage_path);
    if (download.error) throw new Error('Synthetic clean-file download failed.');
    assert.equal(hash(Buffer.from(await download.data.arrayBuffer())), clean.digest);
    await db.$executeRawUnsafe("update prospect_questionnaire_submissions set created_at=now()-interval '25 hours' where request_id=$1::uuid", requestId);
    await assert.rejects(() => staff('file', { id: requestId, file_id: clean.id }), /unavailable|expired/i);
    await db.$executeRawUnsafe("update prospect_questionnaire_files set ticket_expires_at=now()-interval '1 minute' where request_id=$1::uuid", requestId);
    await run(process.execPath, [path.join(__dirname, 'cleanup-prospect-documents.cjs')], { env, timeout: 180000 });
    const purged = await db.$queryRawUnsafe('select purged_at from prospect_questionnaire_files where request_id=$1::uuid', requestId);
    assert.ok(purged.every((file) => file.purged_at), 'Real deletion receipts exist for every synthetic file');
    const remaining = await db.$queryRawUnsafe("select count(*)::int as n from storage.objects where bucket_id='prospect-documents' and name=any($1::text[])", uploaded);
    assert.equal(remaining[0].n, 0, 'Private Storage physically removed the synthetic objects');
    const receipt = { host: 'this-computer', oracleEnabled: false, verifiedAt: new Date().toISOString(),
      clean: 'clean', encrypted: 'blocked', antivirusTest: 'blocked', downloadDigest: 'verified', expiryAccess: 'blocked', storageDeletion: 'verified' };
    await fs.writeFile(path.join(home, 'integration-receipt.json'), JSON.stringify(receipt, null, 2));
    console.log('Real local ClamAV, signed private upload, clean download, encrypted/antivirus blocking, 24-hour cutoff and Storage deletion verified.');
  } finally {
    if (uploaded.length) {
      const removed = await storage.storage.from('prospect-documents').remove(uploaded);
      if (removed.error) throw new Error('Synthetic storage cleanup failed. Retain the fixture references and inspect private worker storage before retrying.');
    }
    await db.$transaction(async (tx) => {
      if (leadId) await tx.$executeRawUnsafe("delete from tasks where related_id=$1::uuid and subject like 'Review questionnaire:%'", leadId);
      for (const table of ['prospect_questionnaire_events', 'prospect_questionnaire_challenges', 'prospect_questionnaire_files', 'prospect_questionnaire_submissions']) {
        await tx.$executeRawUnsafe(`delete from ${table} where request_id=$1::uuid`, requestId);
      }
      await tx.$executeRawUnsafe('delete from prospect_questionnaire_requests where id=$1::uuid and actor_id=$2::uuid', requestId, actor);
      await tx.$executeRawUnsafe('delete from prospect_questionnaire_templates where id=$1::uuid and owner_id=$2::uuid', templateId, actor);
      if (leadId) await tx.$executeRawUnsafe("delete from leads where id=$1::uuid and source='prospect_questionnaire' and agent_user_id=$2::uuid", leadId, actor);
      await tx.$executeRawUnsafe('delete from prospect_questionnaire_limits where key=any($1::text[])',
        [`request:${requestId}`, `email:${createHash('md5').update(`qa-${requestId}@example.invalid`).digest('hex')}`, `network:${hash('synthetic-network')}`]);
      await tx.$executeRawUnsafe('delete from agency_members where user_id=$1::uuid', actor);
      await tx.$executeRawUnsafe('delete from auth.users where id=$1::uuid and email=$2', actor, `local-intake-${actor}@example.invalid`);
    });
    await db.$disconnect();
  }
}
main().catch((error) => { console.error('[local-intake-test]', error.message); process.exitCode = 1; });
