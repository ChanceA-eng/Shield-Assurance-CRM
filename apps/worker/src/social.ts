import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { SOCIAL_QUEUE, SOCIAL_MEDIA_BUCKET, parseSocialQueueJob, type SocialDestination, type SocialQueueJob } from '@crm/shared';
import { openSocialToken, validateSocialTokenConfiguration } from '@crm/shared/social-token-crypto';
import {
  createInstagramImageContainer,
  getInstagramContainerState,
  MetaPublishError,
  publishFacebookPagePost,
  publishInstagramContainer,
  type MetaPublishContent,
  type MetaPublishResult,
} from './social-meta.js';

export interface ClaimedIntent { id: string; lease_id: string; destination: SocialDestination }
export interface SocialExecutionResult {
  outcome: 'retry' | 'failed' | 'uncertain' | 'accepted' | 'published' | 'processing' | 'blocked';
  remote_id?: string;
  permalink?: string | null;
  message?: string;
}
export interface SocialExecutionStore {
  claim(job: SocialQueueJob): Promise<ClaimedIntent | null>;
  start(intent: ClaimedIntent): Promise<boolean>;
  execute(intent: ClaimedIntent): Promise<SocialExecutionResult>;
  finish(intent: ClaimedIntent, result: SocialExecutionResult): Promise<boolean>;
}
export async function executeSocialJob(store: SocialExecutionStore, value: unknown): Promise<void> {
  const job = parseSocialQueueJob(value);
  const intent = await store.claim(job);
  if (!intent || !await store.start(intent)) return;
  const result = await store.execute(intent);
  if (!['retry','failed','uncertain','accepted','published','processing','blocked'].includes(result.outcome)) throw new Error('Unknown social publisher outcome.');
  if (!await store.finish(intent, result)) throw new Error('Social result could not be committed: lease expired. Reconciliation will inspect provider acceptance.');
}

export async function startSocialWorker(): Promise<{ close(): Promise<void> } | null> {
  const allowTest = process.env.SOCIAL_TEST_WORKER_ENABLED === 'true';
  const allowReal = process.env.SOCIAL_REAL_PUBLISHING_ENABLED === 'true';
  if (!allowTest && !allowReal) return null;
  if (allowReal) {
    if (process.env.SOCIAL_META_CONNECTIONS_ENABLED !== 'true'
      || !/^v\d{1,3}\.\d{1,2}$/.test(process.env.SOCIAL_META_GRAPH_API_VERSION ?? '')
      || !process.env.SOCIAL_META_CLIENT_SECRET) {
      throw new Error('Real social publishing requires enabled Meta connections, a pinned SOCIAL_META_GRAPH_API_VERSION, and SOCIAL_META_CLIENT_SECRET.');
    }
    if (!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Real social publishing requires Supabase URL and service credentials for private image delivery.');
    }
    validateSocialTokenConfiguration();
  }
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('Social publishing worker requires DIRECT_URL or DATABASE_URL.');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const connection = { host: process.env.REDIS_HOST ?? '127.0.0.1', port: Number(process.env.REDIS_PORT ?? 6379) };
  const queue = new Queue(SOCIAL_QUEUE, { connection });
  async function rpc<T>(query: string, ...args: Array<string | number | boolean | null>): Promise<T> {
    const rows = await db.$queryRawUnsafe<Array<{ value: T }>>(query, ...args);
    if (rows.length !== 1) throw new Error('Social worker database response is missing.');
    return rows[0].value;
  }
  const store: SocialExecutionStore = {
    claim: (job) => rpc('select public.claim_social_intent_gated($1::uuid,$2::integer,$3::boolean,$4::boolean) as value',
      job.id, job.version, allowTest, allowReal),
    start: (intent) => rpc('select public.start_social_intent($1::uuid,$2::uuid) as value', intent.id, intent.lease_id),
    execute: async (intent) => {
      if (intent.destination === 'test') {
        return rpc('select public.execute_social_test($1::uuid,$2::uuid) as value', intent.id, intent.lease_id);
      }
      const context = await rpc<SocialPublishContext>('select public.load_social_publish_context($1::uuid,$2::uuid) as value', intent.id, intent.lease_id);
      return publishSocialTarget(context, intent, db);
    },
    finish: (intent, result) => intent.destination === 'test'
      ? rpc('select public.finish_social_intent($1::uuid,$2::uuid,$3::text) as value',
        intent.id, intent.lease_id, result.outcome)
      : rpc('select public.finish_social_publish_intent($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::text) as value',
        intent.id, intent.lease_id, result.outcome, result.remote_id ?? null, result.permalink ?? null, result.message ?? null),
  };
  const worker = new Worker(SOCIAL_QUEUE, (job) => executeSocialJob(store, job.data), { connection, concurrency: 2 });
  worker.on('error', (error) => console.error('[social/worker]', error.message));
  worker.on('failed', (job, error) => console.error('[social/job]', job?.id, error.message));
  queue.on('error', (error) => console.error('[social/queue]', error.message));
  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let polling: Promise<void> = Promise.resolve();
  async function poll(): Promise<void> {
    const rows = await rpc<unknown[]>(
      'select public.reconcile_social_engine_gated($1::boolean,$2::boolean) as value', allowTest, allowReal);
    if (!Array.isArray(rows)) throw new Error('Social outbox response is invalid.');
    for (const value of rows) {
      const job = parseSocialQueueJob(value);
      await queue.add('execute-intent', job, { jobId: `${job.id}-${job.version}`, removeOnComplete: true, removeOnFail: true, attempts: 1 });
    }
  }
  async function pollContinuously(): Promise<void> {
    try { await poll(); } catch (error) {
      console.error('[social/reconcile]', error instanceof Error ? error.message : error);
    } finally {
      if (!stopping) timer = setTimeout(() => { polling = pollContinuously(); }, 15000);
    }
  }
  try {
    await queue.waitUntilReady();
    await worker.waitUntilReady();
    await poll();
  } catch (error) {
    const cleanup = await Promise.allSettled([worker.close(true), queue.close(), db.$disconnect()]);
    for (const result of cleanup) if (result.status === 'rejected') console.error('[social/startup-cleanup]', result.reason);
    throw error;
  }
  timer = setTimeout(() => { polling = pollContinuously(); }, 15000);
  console.log(`[social-worker] Ready. Test adapter ${allowTest ? 'enabled' : 'disabled'}; live publishing ${allowReal ? 'enabled' : 'disabled'}.`);
  return { async close() {
    stopping = true;
    if (timer) clearTimeout(timer);
    await polling;
    const cleanup = await Promise.allSettled([worker.close(), queue.close(), db.$disconnect()]);
    const failures = cleanup.filter((result) => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map((result) => result.reason), 'Social publishing worker shutdown failed.');
  } };
}

interface SocialPublishContext {
  intent_id: string;
  workspace_id: string;
  destination: Exclude<SocialDestination, 'test'>;
  connection_id: string;
  account_id: string;
  account_name: string;
  page_id: string;
  encrypted_page_token: string;
  token_context: string;
  caption: string;
  link_url: string | null;
  image_path: string | null;
  container_id: string | null;
  container_status: 'none' | 'processing';
  publish_dispatched_at: string | null;
}

async function signedSocialImageUrl(path: string): Promise<string> {
  const rawUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!rawUrl || !serviceKey) throw new Error('Private social image delivery requires Supabase URL and service credentials in the worker.');
  const base = new URL(rawUrl);
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Social media storage must use HTTPS.');
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/image\.jpg$/i.test(path)) throw new Error('Approved social image path is invalid.');
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const endpoint = new URL(`/storage/v1/object/sign/${SOCIAL_MEDIA_BUCKET}/${encodedPath}`, base);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 1800 }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Could not create an expiring provider image URL.');
  }
  if (!response.ok) throw new Error('Private social image storage could not create a provider URL.');
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as Record<string, unknown>).signedURL !== 'string') {
    throw new Error('Private social image storage returned an invalid provider URL.');
  }
  const rawSignedUrl = (body as Record<string, string>).signedURL;
  const signedUrl = rawSignedUrl.startsWith('/object/sign/')
    ? new URL(`/storage/v1${rawSignedUrl}`, base)
    : new URL(rawSignedUrl, base);
  if (signedUrl.origin !== base.origin || !signedUrl.pathname.includes(`/storage/v1/object/sign/${SOCIAL_MEDIA_BUCKET}/`)) {
    throw new Error('Private social image storage returned an unsafe provider URL.');
  }
  return signedUrl.toString();
}

async function publishSocialTarget(
  context: SocialPublishContext,
  intent: ClaimedIntent,
  db: PrismaClient,
): Promise<SocialExecutionResult> {
  if (context.intent_id !== intent.id || context.destination !== intent.destination) {
    throw new Error('Social publishing context does not match the claimed intent.');
  }
  if (context.publish_dispatched_at) {
    return { outcome: 'uncertain', message: 'A prior provider request may have been accepted. Check Meta before any retry.' };
  }
  const token = openSocialToken(context.encrypted_page_token, context.token_context);
  const graphConfig = {
    graphVersion: process.env.SOCIAL_META_GRAPH_API_VERSION ?? '',
    appSecret: process.env.SOCIAL_META_CLIENT_SECRET ?? '',
  };
  const imageUrl = context.image_path ? await signedSocialImageUrl(context.image_path) : null;
  const content: MetaPublishContent = { caption: context.caption, linkUrl: context.link_url, imageUrl };
  const beginDispatch = async (): Promise<boolean> => {
    const rows = await db.$queryRawUnsafe<Array<{ value: boolean }>>(
      'select public.begin_social_provider_dispatch($1::uuid,$2::uuid) as value', intent.id, intent.lease_id);
    if (rows.length !== 1) throw new Error('Social dispatch authorization response is missing.');
    return rows[0].value;
  };
  const finishProviderCall = async (call: () => Promise<MetaPublishResult>): Promise<SocialExecutionResult> => {
    if (!await beginDispatch()) return { outcome: 'blocked', message: 'Publishing authorization changed before the provider request.' };
    try {
      const result = await call();
      return { outcome: 'published', remote_id: result.remoteId, permalink: result.permalink, message: result.warning };
    } catch (error) {
      if (!(error instanceof MetaPublishError)) throw error;
      return {
        outcome: error.uncertain ? 'uncertain' : error.retryable ? 'retry' : 'failed',
        message: error.message,
      };
    }
  };
  if (context.destination === 'facebook_page') {
    return finishProviderCall(() => publishFacebookPagePost(graphConfig, token, context.account_id, content));
  }
  if (!context.container_id) {
    if (!imageUrl) return { outcome: 'blocked', message: 'Instagram requires an approved image.' };
    try {
      const containerId = await createInstagramImageContainer(graphConfig, token, context.account_id, content);
      const rows = await db.$queryRawUnsafe<Array<{ value: boolean }>>(
        'select public.record_social_publish_container($1::uuid,$2::uuid,$3::text) as value',
        intent.id, intent.lease_id, containerId);
      if (rows.length !== 1 || !rows[0].value) throw new Error('Instagram container could not be persisted before processing.');
      return { outcome: 'processing' };
    } catch (error) {
      if (error instanceof MetaPublishError) return {
        outcome: error.uncertain ? 'retry' : error.retryable ? 'retry' : 'failed',
        message: error.message,
      };
      throw error;
    }
  }
  try {
    const status = await getInstagramContainerState(graphConfig, token, context.container_id);
    if (status === 'in_progress') return { outcome: 'processing' };
    if (status === 'error' || status === 'expired') return { outcome: 'failed', message: 'Instagram rejected or expired the media container. Review the image and prepare a new intent.' };
    if (status !== 'finished') return { outcome: 'retry', message: 'Instagram processing status was not recognized. The CRM will check again without creating a new container.' };
    return finishProviderCall(() => publishInstagramContainer(graphConfig, token, context.account_id, context.container_id!));
  } catch (error) {
    if (error instanceof MetaPublishError) return {
      outcome: error.uncertain ? 'uncertain' : error.retryable ? 'retry' : 'failed',
      message: error.message,
    };
    throw error;
  }
}
