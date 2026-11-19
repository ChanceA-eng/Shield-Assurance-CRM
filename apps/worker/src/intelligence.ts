import { Queue, Worker } from 'bullmq';

export async function startIntelligenceWorker(): Promise<{ close: () => Promise<void> } | null> {
  if (process.env.CRM_INTELLIGENCE_WORKER_ENABLED !== 'true') return null;
  const origin = process.env.CRM_WEB_ORIGIN, secret = process.env.CRON_SECRET;
  if (!origin || !secret) throw new Error('OIP worker requires CRM_WEB_ORIGIN and CRON_SECRET.');
  const url = new URL('/api/cron/intelligence', origin);
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('OIP worker requires HTTPS.');
  const connection = { host: process.env.REDIS_HOST ?? '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379) };
  const queue = new Queue('opportunity-intelligence', { connection });
  await queue.upsertJobScheduler('opportunity-reconciliation', { every: 60000 }, {
    name: 'reconcile', opts: { removeOnComplete: 20, removeOnFail: 50, attempts: 5, backoff: { type: 'exponential', delay: 5000 } },
  });
  const worker = new Worker('opportunity-intelligence', async () => {
    const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(55000) });
    if (!response.ok || response.status === 207) throw new Error(`OIP evaluation needs review (HTTP ${response.status}). Check watched records.`);
  }, { connection, concurrency: 1, lockDuration: 90000 });
  worker.on('failed', (_job, failure) => console.error('[intelligence-worker]', failure.message));
  return { close: async () => { await worker.close(); await queue.close(); } };
}
