export const SOCIAL_QUEUE = 'social-marketing-execution';
export const SOCIAL_TIMEZONE = 'America/Phoenix';
export const SOCIAL_TEST_SCENARIOS = ['success', 'retry_once', 'permanent_failure', 'uncertain'] as const;
export type SocialTestScenario = typeof SOCIAL_TEST_SCENARIOS[number];
export type SocialIntentState = 'awaiting_approval' | 'approved' | 'scheduled' | 'running' | 'retry_wait' | 'confirming' | 'simulated' | 'published' | 'failed' | 'canceled' | 'blocked';
export type SocialDestination = 'test' | 'facebook_page' | 'instagram_business';
export interface SocialPublishConnection {
  id: string;
  platform: Exclude<SocialDestination, 'test'>;
  account_name: string;
  state: 'connected' | 'reconnect' | 'revocation_pending' | 'disconnected';
  can_publish: boolean;
  capability_reason: string | null;
  token_expires_at: string;
}
export interface SocialIntent {
  id: string; post_id: string; title: string; revision: number; destination: SocialDestination; scenario: SocialTestScenario | null;
  connection_id: string | null; remote_id: string | null; permalink: string | null;
  publish_dispatched_at: string | null;
  container_status: 'none' | 'processing';
  state: SocialIntentState; version: number; scheduled_at: string | null; timezone: string;
  attempt_count: number; message: string; receipt_id: string | null; updated_at: string;
  events: Array<{ version: number; state: SocialIntentState; actor_id: string | null; message: string; recorded_at: string }>;
  attempts: Array<{ attempt: number; started_at: string; finished_at: string | null; outcome: string | null }>;
}
export interface SocialEngineList {
  intents: SocialIntent[]; connections: SocialPublishConnection[]; paused: boolean; can_manage: boolean;
  worker_seen_at: string | null; worker_test_enabled: boolean; worker_real_enabled: boolean;
}
export type SocialEngineCommand =
  | { action: 'prepare'; id: string; post_id: string; revision: number; scenario: SocialTestScenario }
  | { action: 'prepare_publish'; id: string; post_id: string; revision: number; connection_id: string }
  | { action: 'resolve_publish'; id: string; expected_version: number; resolution: 'published'; remote_id: string; permalink?: string | null }
  | { action: 'resolve_publish'; id: string; expected_version: number; resolution: 'not_published' }
  | { action: 'approve' | 'cancel' | 'retry' | 'confirm'; id: string; expected_version: number }
  | { action: 'schedule'; id: string; expected_version: number; scheduled_at: string; timezone: typeof SOCIAL_TIMEZONE }
  | { action: 'pause'; paused: boolean };
export function parseSocialEngineCommand(value: unknown): SocialEngineCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Send a scheduling command.');
  const body: Record<string, unknown> = { ...value };
  const uuid = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const version = (number: unknown): number is number => typeof number === 'number' && Number.isInteger(number) && number > 0 && number < 2147483647;
  let result: SocialEngineCommand;
  if (body.action === 'pause' && typeof body.paused === 'boolean') result = { action: 'pause', paused: body.paused };
  else if (body.action === 'prepare' && uuid(body.id) && uuid(body.post_id) && version(body.revision)
    && SOCIAL_TEST_SCENARIOS.some((scenario) => scenario === body.scenario)) {
    result = { action: 'prepare', id: body.id, post_id: body.post_id, revision: body.revision, scenario: body.scenario as SocialTestScenario };
  } else if (body.action === 'prepare_publish' && uuid(body.id) && uuid(body.post_id) && version(body.revision) && uuid(body.connection_id)) {
    result = { action: 'prepare_publish', id: body.id, post_id: body.post_id, revision: body.revision, connection_id: body.connection_id };
  } else if (body.action === 'resolve_publish' && uuid(body.id) && version(body.expected_version)
    && body.resolution === 'published' && typeof body.remote_id === 'string' && /^[0-9_]{1,70}$/.test(body.remote_id)) {
    let permalink: string | null | undefined;
    if (body.permalink !== undefined && body.permalink !== null) {
      if (typeof body.permalink !== 'string') throw new Error('Enter a valid HTTPS provider permalink.');
      try {
        const url = new URL(body.permalink);
        if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error();
        permalink = url.toString();
      } catch { throw new Error('Enter a valid HTTPS provider permalink.'); }
    } else permalink = body.permalink;
    result = {
      action: 'resolve_publish', id: body.id, expected_version: body.expected_version,
      resolution: 'published', remote_id: body.remote_id, ...(permalink === undefined ? {} : { permalink }),
    };
  } else if (body.action === 'resolve_publish' && uuid(body.id) && version(body.expected_version)
    && body.resolution === 'not_published') {
    result = { action: 'resolve_publish', id: body.id, expected_version: body.expected_version, resolution: 'not_published' };
  } else if (uuid(body.id) && version(body.expected_version)) {
    if (body.action === 'schedule' && typeof body.scheduled_at === 'string'
      && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.scheduled_at)
      && Number.isFinite(Date.parse(body.scheduled_at)) && new Date(body.scheduled_at).toISOString().replace('.000Z', 'Z') === body.scheduled_at.replace('.000Z', 'Z')
      && body.timezone === SOCIAL_TIMEZONE) {
      result = { action: 'schedule', id: body.id, expected_version: body.expected_version, scheduled_at: body.scheduled_at, timezone: SOCIAL_TIMEZONE };
    } else if (body.action === 'approve' || body.action === 'cancel' || body.action === 'retry' || body.action === 'confirm') {
      result = { action: body.action, id: body.id, expected_version: body.expected_version };
    } else throw new Error('Choose a supported scheduling action and Arizona date/time.');
  } else throw new Error('Choose a valid intent and version.');
  if (Object.keys(body).some((key) => !Object.prototype.hasOwnProperty.call(result, key))) throw new Error('Unsupported scheduling field.');
  return result;
}
export interface SocialQueueJob { id: string; version: number }
export function parseSocialQueueJob(value: unknown): SocialQueueJob {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['id','version'].includes(key))) throw new Error('Invalid social queue job.');
  const command = parseSocialEngineCommand({ id: 'id' in value ? value.id : null, action: 'retry', expected_version: 'version' in value ? value.version : null });
  if (command.action !== 'retry') throw new Error('Invalid social queue job.');
  return { id: command.id, version: command.expected_version };
}
