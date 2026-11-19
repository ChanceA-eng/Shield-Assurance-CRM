const path = require('node:path');

require(require.resolve('dotenv', { paths: [path.resolve(__dirname, '..', '..', 'api')] }))
  .config({ path: path.resolve(__dirname, '..', '.env.local') });

const secret = process.env.CRON_SECRET?.trim();
if (!secret) throw new Error('Configure CRON_SECRET in apps/web/.env.local before running local research.');

const shutdown = new AbortController();
process.once('SIGINT', () => shutdown.abort());
process.once('SIGTERM', () => shutdown.abort());

async function main() {
  const { setTimeout: delay } = require('node:timers/promises');
  while (!shutdown.signal.aborted) {
    let wait = 15000;
    try {
      const response = await fetch('http://127.0.0.1:3000/api/cron/heartbeat', {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ job: 'business-research' }),
        signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(90000)]),
      });
      const result = await response.json();
      if (!response.ok || result.ok !== true) {
        throw new Error(`Local research heartbeat failed (HTTP ${response.status}): ${JSON.stringify(result)}`);
      }
      const summary = result.run?.summary;
      console.log('[local-research]', JSON.stringify(summary));
      if (summary?.directory?.processed > 0) wait = 1000;
    } catch (error) {
      if (shutdown.signal.aborted) break;
      console.error('[local-research]', error);
    }
    try {
      await delay(wait, undefined, { signal: shutdown.signal });
    } catch (error) {
      if (!shutdown.signal.aborted) throw error;
    }
  }
}

main().catch((error) => {
  console.error('[local-research]', error);
  process.exitCode = 1;
});
