const { createClient } = require('@supabase/supabase-js');

async function runCleanup(db) {
  const rpc = async (action, data) => {
    const result = await db.rpc('prospect_questionnaire_cleanup_job', { p_action: action, p_data: data });
    if (result.error) throw new Error(`Document cleanup ${action} failed (${result.error.code}).`);
    return result.data;
  };
  for (let count = 0; count < 100; count++) {
    const file = await rpc('claim', {});
    if (!file) return;
    const removed = await db.storage.from('prospect-documents').remove([file.storage_path]);
    if (removed.error) throw new Error('Private document deletion failed. The lease will expire for retry; no deletion receipt was recorded.');
    await rpc('finish', { id: file.id, lease: file.lease });
    console.info('[prospect-cleanup] Document deletion recorded.');
  }
}

async function main() {
  if (process.env.CRM_PROSPECT_CLEANUP_APPROVED !== 'true') throw new Error('Approve document retention and private cleanup hosting before running this worker.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configure private storage credentials on the approved cleanup worker.');
  await runCleanup(createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
  }));
}
module.exports = { runCleanup };
if (require.main === module) main().catch((failure) => { console.error('[prospect-cleanup]', failure.message); process.exitCode = 1; });
