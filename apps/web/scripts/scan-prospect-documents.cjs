const { createHash } = require('node:crypto');
const { mkdtemp, writeFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createClient } = require('@supabase/supabase-js');
const run = promisify(execFile);

function matchesFile(bytes, type) {
  const starts = (hex) => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  if (type === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
  if (type === 'image/jpeg') return starts('ffd8ff');
  if (type === 'image/png') return starts('89504e470d0a1a0a');
  if (type === 'image/webp') return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
  if (['image/heic', 'image/heif'].includes(type)) return bytes.subarray(4, 8).toString() === 'ftyp'
    && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(bytes.subarray(8, 12).toString());
  return false;
}

function signatureVersion(text, now = Date.now()) {
  const version = text.trim();
  const date = Date.parse(version.split('/').slice(2).join('/'));
  if (!version.startsWith('ClamAV ') || !Number.isFinite(date) || date > now + 3600000 || now - date > 48 * 3600000) {
    throw new Error('ClamAV signatures must be valid and updated within 48 hours. Uploads remain blocked.');
  }
  return version;
}

async function main() {
  if (process.env.CRM_PROSPECT_SCANNER_APPROVED !== 'true') throw new Error('Scanner hosting/cost approval is required before running this worker.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !process.env.PROSPECT_CLAMSCAN_PATH) throw new Error('Configure private storage credentials and PROSPECT_CLAMSCAN_PATH on the approved worker.');
  const executable = process.env.PROSPECT_CLAMSCAN_PATH;
  const database = process.env.PROSPECT_CLAMAV_DATABASE ? [`--database=${process.env.PROSPECT_CLAMAV_DATABASE}`] : [];
  const version = signatureVersion((await run(executable, [...database, '--version'], { timeout: 30000 })).stdout);
  const db = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) },
  });
  const rpc = async (action, data) => {
    const result = await db.rpc('prospect_questionnaire_scan', { p_action: action, p_data: data });
    if (result.error) throw new Error(`Scanner ${action} could not be recorded (${result.error.code}).`);
    return result.data;
  };
  for (let count = 0; count < 10; count++) {
    const file = await rpc('claim', { version });
    if (!file) return;
    let directory;
    let state = 'failed', digest = null;
    try {
      const object = await db.storage.from('prospect-documents').download(file.storage_path);
      if (object.error || !object.data) throw new Error('Private storage read failed.');
      const bytes = Buffer.from(await object.data.arrayBuffer());
      if (bytes.length !== file.size || bytes.length > 10 * 1024 * 1024 || !matchesFile(bytes, file.content_type)) {
        state = 'blocked';
      } else {
        directory = await mkdtemp(path.join(tmpdir(), 'crm-prospect-scan-'));
        const target = path.join(directory, 'document');
        await writeFile(target, bytes, { mode: 0o600 });
        try {
          await run(executable, [...database, '--no-summary', '--max-filesize=11M', '--max-scansize=12M',
            '--max-recursion=2', '--alert-exceeds-max=yes', '--alert-encrypted=yes', '--', target],
          { timeout: 90000, maxBuffer: 128 * 1024 });
          state = 'clean'; digest = createHash('sha256').update(bytes).digest('hex');
        } catch (failure) {
          if (failure.code === 1) state = 'blocked';
          else throw new Error('ClamAV could not finish the safety check.');
        }
      }
    } catch (failure) {
      // Do not log filenames, document contents, private storage URLs or scanner output.
      console.error('[prospect-scanner] Check failed; document remains blocked.', failure.message);
    } finally {
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    await rpc('finish', { id: file.id, lease: file.lease, state, digest, version });
    console.log(`[prospect-scanner] Recorded ${state} verdict.`);
  }
}
module.exports = { matchesFile, signatureVersion };
if (require.main === module) main().catch((failure) => { console.error(failure.message); process.exitCode = 1; });
