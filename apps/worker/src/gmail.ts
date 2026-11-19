import { Queue, Worker } from 'bullmq';

export async function startGmailWorker(): Promise<{ close: () => Promise<void> } | null> {
  if (process.env.CRM_MULTI_AGENT_ENABLED !== 'true' || process.env.CRM_GMAIL_ENABLED !== 'true') return null;
  const origin = process.env.CRM_WEB_ORIGIN;
  const secret = process.env.CRON_SECRET;
  if (!origin || !secret) throw new Error('Gmail worker requires CRM_WEB_ORIGIN and CRON_SECRET.');
  const url = new URL('/api/gmail/sync/worker', origin);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new Error('Gmail worker requires HTTPS.');
  const connection = { host: process.env.REDIS_HOST ?? '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379) };
  const queue = new Queue('gmail-sync', { connection });
  await queue.upsertJobScheduler('gmail-reconciliation', { every: 60000 }, {
    name: 'reconcile', opts: { removeOnComplete: 20, removeOnFail: 20, attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
  });
  const worker = new Worker('gmail-sync', async () => {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(240000) });
    if (!response.ok) throw new Error(`Gmail reconciliation failed (HTTP ${response.status}). Check CRM connection health.`);
  }, { connection, concurrency: 1, lockDuration: 300000 });
  worker.on('failed', (_job, error) => console.error('[gmail-worker]', error.message));
  return { close: async () => { await worker.close(); await queue.close(); } };
}
