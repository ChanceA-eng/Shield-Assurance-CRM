import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeSocialJob, startSocialWorker, type SocialExecutionStore } from './social.js';
const infrastructure = vi.hoisted(() => ({
  raw: vi.fn(), queueReady: vi.fn(), workerReady: vi.fn(), add: vi.fn(),
  queueClose: vi.fn(), workerClose: vi.fn(), disconnect: vi.fn(),
}));
vi.mock('@prisma/client', () => ({ PrismaClient: vi.fn(() => ({ $queryRawUnsafe: infrastructure.raw, $disconnect: infrastructure.disconnect })) }));
vi.mock('bullmq', () => ({
  Queue: vi.fn(() => ({ on: vi.fn(), waitUntilReady: infrastructure.queueReady, add: infrastructure.add, close: infrastructure.queueClose })),
  Worker: vi.fn(() => ({ on: vi.fn(), waitUntilReady: infrastructure.workerReady, close: infrastructure.workerClose })),
}));
const job = { id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d', version: 3 };
const intent = { id: job.id, lease_id: '48b06a5e-4ca6-4b32-a185-7293b4bd4a2d', destination: 'test' as const };
let store: SocialExecutionStore;
beforeEach(() => {
  vi.clearAllMocks();
  infrastructure.raw.mockResolvedValue([{ value: [] }]);
  infrastructure.queueReady.mockResolvedValue(undefined); infrastructure.workerReady.mockResolvedValue(undefined);
  infrastructure.add.mockResolvedValue(undefined); infrastructure.queueClose.mockResolvedValue(undefined);
  infrastructure.workerClose.mockResolvedValue(undefined); infrastructure.disconnect.mockResolvedValue(undefined);
  store = { claim: vi.fn().mockResolvedValue(intent), start: vi.fn().mockResolvedValue(true),
    execute: vi.fn().mockResolvedValue({ outcome: 'accepted' }), finish: vi.fn().mockResolvedValue(true) };
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('Social test job fencing', () => {
  it('does not dispatch obsolete or duplicate jobs', async () => {
    vi.mocked(store.claim).mockResolvedValue(null);
    await executeSocialJob(store, job);
    expect(store.start).not.toHaveBeenCalled(); expect(store.execute).not.toHaveBeenCalled();
  });
  it('does not dispatch when pause, revocation, or lease fencing prevents start', async () => {
    vi.mocked(store.start).mockResolvedValue(false);
    await executeSocialJob(store, job);
    expect(store.execute).not.toHaveBeenCalled(); expect(store.finish).not.toHaveBeenCalled();
  });
  it.each(['accepted','retry','failed','uncertain'] as const)('commits %s without performing an in-process retry', async (outcome) => {
    vi.mocked(store.execute).mockResolvedValue({ outcome });
    await executeSocialJob(store, job);
    expect(store.claim).toHaveBeenCalledWith(job);
    expect(store.finish).toHaveBeenCalledTimes(1);
    expect(store.finish).toHaveBeenCalledWith(intent, { outcome });
    expect(store.execute).toHaveBeenCalledTimes(1);
  });
  it('commits an independent real provider result without test receipts', async () => {
    const liveIntent = { ...intent, destination: 'facebook_page' as const };
    vi.mocked(store.claim).mockResolvedValue(liveIntent);
    vi.mocked(store.execute).mockResolvedValue({
      outcome: 'published', remote_id: '123_456', permalink: 'https://www.facebook.com/123_456',
    });
    await executeSocialJob(store, job);
    expect(store.finish).toHaveBeenCalledWith(liveIntent, {
      outcome: 'published', remote_id: '123_456', permalink: 'https://www.facebook.com/123_456',
    });
  });
  it('leaves lost acknowledgement for database receipt reconciliation, not blind retry', async () => {
    vi.mocked(store.execute).mockRejectedValue(new Error('Connection lost after acceptance'));
    await expect(executeSocialJob(store, job)).rejects.toThrow('Connection lost');
    expect(store.finish).not.toHaveBeenCalled(); expect(store.execute).toHaveBeenCalledTimes(1);
  });
  it('surfaces expired finish instead of claiming success', async () => {
    vi.mocked(store.finish).mockResolvedValue(false);
    await expect(executeSocialJob(store, job)).rejects.toThrow('lease expired');
  });
  it('rejects jobs carrying untrusted content before claiming', async () => {
    await expect(executeSocialJob(store, { ...job, caption: 'untrusted' })).rejects.toThrow();
    expect(store.claim).not.toHaveBeenCalled();
  });
  it('does not connect to infrastructure when disabled', async () => {
    vi.stubEnv('SOCIAL_TEST_WORKER_ENABLED', 'false'); vi.stubEnv('SOCIAL_REAL_PUBLISHING_ENABLED', 'false');
    try { expect(await startSocialWorker()).toBeNull(); } finally { vi.unstubAllEnvs(); }
  });
  it('requires explicit Meta readiness before enabling real publishing', async () => {
    vi.stubEnv('SOCIAL_REAL_PUBLISHING_ENABLED', 'true');
    vi.stubEnv('SOCIAL_META_CONNECTIONS_ENABLED', 'false');
    await expect(startSocialWorker()).rejects.toThrow('enabled Meta connections');
    expect(infrastructure.raw).not.toHaveBeenCalled();
  });
  it('fails startup and releases resources when schema readiness fails', async () => {
    vi.stubEnv('SOCIAL_TEST_WORKER_ENABLED', 'true'); vi.stubEnv('DIRECT_URL', 'postgresql://local-fixture.invalid');
    infrastructure.raw.mockRejectedValue(new Error('Missing reconcile_social_engine migration'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(startSocialWorker()).rejects.toThrow('Missing reconcile');
    expect(infrastructure.workerClose).toHaveBeenCalledWith(true);
    expect(infrastructure.queueClose).toHaveBeenCalledTimes(1); expect(infrastructure.disconnect).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });
  it('rejects malformed outbox rather than reporting healthy startup', async () => {
    vi.stubEnv('SOCIAL_TEST_WORKER_ENABLED', 'true'); vi.stubEnv('DIRECT_URL', 'postgresql://local-fixture.invalid');
    infrastructure.raw.mockResolvedValue([{ value: [{ ...job, caption: 'forbidden' }] }]);
    await expect(startSocialWorker()).rejects.toThrow('Invalid social queue');
    expect(infrastructure.add).not.toHaveBeenCalled(); expect(infrastructure.disconnect).toHaveBeenCalledTimes(1);
  });
  it('restores due queue data at startup and every 15 seconds without carrying content', async () => {
    vi.useFakeTimers();
    vi.stubEnv('SOCIAL_TEST_WORKER_ENABLED', 'true'); vi.stubEnv('DIRECT_URL', 'postgresql://local-fixture.invalid');
    infrastructure.raw.mockResolvedValue([{ value: [job] }]);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const worker = await startSocialWorker();
    if (!worker) throw new Error('Test worker did not start.');
    expect(infrastructure.add).toHaveBeenCalledWith('execute-intent', job, { jobId: `${job.id}-${job.version}`, removeOnComplete: true, removeOnFail: true, attempts: 1 });
    await vi.advanceTimersByTimeAsync(15000);
    expect(infrastructure.add).toHaveBeenCalledTimes(2);
    await worker.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(infrastructure.add).toHaveBeenCalledTimes(2);
  });
});
