const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

async function main() {
  const home = process.env.CRM_LOCAL_INTAKE_HOME || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ShieldAssurance', 'SecureIntake'));
  if (!home) throw new Error('Start the local worker using local-intake-worker.ps1.');
  const settings = JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'));
  if (settings.oracleEnabled !== false) throw new Error('Oracle must remain disabled for the computer worker.');
  const lockPath = path.join(home, 'worker.lock');
  let lock;
  try { lock = await fs.open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await fs.readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid worker lock. Inspect it before restarting.');
    try { process.kill(pid, 0); throw new Error('The local worker is already running.'); }
    catch (failure) { if (failure.code !== 'ESRCH') throw failure; }
    await fs.unlink(lockPath);
    lock = await fs.open(lockPath, 'wx');
  }
  await lock.writeFile(String(process.pid));
  const statusPath = path.join(home, 'status.json');
  const state = { pid: process.pid, host: 'this-computer', oracleEnabled: false, startedAt: new Date().toISOString(), jobs: {} };
  const children = new Set();
  let closing = false;
  let fatal;
  const persist = async () => {
    const temporary = `${statusPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
    await fs.rename(temporary, statusPath);
  };
  const env = { ...process.env };
  const temporaryDirectory = path.join(home, 'temp');
  for (const entry of await fs.readdir(temporaryDirectory, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith('crm-prospect-scan-')) {
      await fs.rm(path.join(temporaryDirectory, entry.name), { recursive: true, force: true });
    }
  }
  process.loadEnvFile(path.join(settings.repository, 'apps', 'web', '.env.local'));
  for (const name of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!process.env[name]) throw new Error(`Local worker requires ${name} in apps/web/.env.local.`);
    env[name] = process.env[name];
  }
  Object.assign(env, {
    CRM_PROSPECT_SCANNER_APPROVED: 'true', CRM_PROSPECT_CLEANUP_APPROVED: 'true',
    PROSPECT_CLAMSCAN_PATH: path.join(settings.bin, 'clamscan.exe'),
    PROSPECT_CLAMAV_DATABASE: path.join(home, 'database'),
    TEMP: temporaryDirectory, TMP: temporaryDirectory, TMPDIR: temporaryDirectory,
  });
  const log = async (message) => {
    const target = path.join(home, 'logs', 'worker.log');
    const existing = await fs.stat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
    if (existing?.size > 2 * 1024 * 1024) await fs.writeFile(target, '');
    await fs.appendFile(target, `${new Date().toISOString()} ${message}\n`);
  };
  const execute = (command, args, timeout) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true, cwd: settings.repository, stdio: ['ignore', 'ignore', 'pipe'] });
    let detail = '';
    child.stderr.on('data', (bytes) => { detail = (detail + bytes.toString()).slice(-4096); });
    children.add(child);
    const timer = setTimeout(() => child.kill(), timeout);
    child.once('error', (error) => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timer); children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`Worker process exited ${code ?? 'after timeout/shutdown'}.${detail ? ` ${detail.trim()}` : ''}`));
    });
  });
  const jobs = [
    { name: 'signatures', interval: 6 * 3600000, command: path.join(settings.bin, 'freshclam.exe'),
      args: [`--config-file=${path.join(home, 'freshclam.conf')}`], timeout: 300000 },
    { name: 'cleanup', interval: 60000, command: process.execPath, args: [path.join(__dirname, 'cleanup-prospect-documents.cjs')], timeout: 240000 },
    { name: 'scanner', interval: 60000, command: process.execPath, args: [path.join(__dirname, 'scan-prospect-documents.cjs')], timeout: 1500000 },
  ];
  const active = new Map();
  const tick = async (job) => {
    if (closing || active.has(job.name)) return;
    const previous = state.jobs[job.name];
    if (previous?.finishedAt && Date.now() - Date.parse(previous.finishedAt) < job.interval) return;
    const work = (async () => {
      state.jobs[job.name] = { startedAt: new Date().toISOString(), state: 'running' };
      try {
        await execute(job.command, job.args, job.timeout);
        state.jobs[job.name] = { ...state.jobs[job.name], state: 'ok', finishedAt: new Date().toISOString() };
        await log(`${job.name}: ok`);
      } catch (error) {
        state.jobs[job.name] = { ...state.jobs[job.name], state: 'failed', finishedAt: new Date().toISOString(), error: error.message };
        await log(`${job.name}: ${error.message} Check the schema, credentials, signatures and private worker configuration.`);
      }
    })().finally(() => active.delete(job.name));
    active.set(job.name, work);
    work.catch((error) => { fatal = error; stop(); });
  };
  const stop = () => { closing = true; for (const child of children) child.kill(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await log(`Local worker started; Oracle disabled; available RAM ${Math.round(os.freemem() / 1024 / 1024)} MiB.`);
    while (!closing) {
      for (const job of jobs) void tick(job);
      await persist();
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    await Promise.all(active.values());
    if (fatal) throw fatal;
  } finally {
    await lock.close();
    await fs.unlink(lockPath);
  }
}
if (require.main === module) main().catch((error) => { console.error('[local-intake]', error.message); process.exitCode = 1; });
