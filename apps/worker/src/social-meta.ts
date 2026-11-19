import { createHmac } from 'node:crypto';

export interface MetaGraphConfig {
  graphVersion: string;
  appSecret: string;
}

export interface MetaPublishContent {
  caption: string;
  linkUrl: string | null;
  imageUrl: string | null;
}

export interface MetaPublishResult {
  remoteId: string;
  permalink: string | null;
  warning?: string;
}

export type InstagramContainerState = 'in_progress' | 'finished' | 'error' | 'expired' | 'unknown';

export class MetaPublishError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly uncertain: boolean,
  ) {
    super(message);
    this.name = 'MetaPublishError';
  }
}

function assertConfig(config: MetaGraphConfig): void {
  if (!/^v\d{1,3}\.\d{1,2}$/.test(config.graphVersion) || !config.appSecret) {
    throw new Error('Meta publishing configuration is incomplete.');
  }
}

function graphUrl(config: MetaGraphConfig, path: string, parameters: Record<string, string> = {}): URL {
  assertConfig(config);
  if (!/^[0-9]{1,32}\/[a-z_]+$/.test(path) && !/^[0-9_]{1,70}$/.test(path)) {
    throw new Error('Meta publishing path is invalid.');
  }
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path}`);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  return url;
}

function safeProviderMessage(status: number, error: unknown): { message: string; retryable: boolean } {
  const record = error && typeof error === 'object' && !Array.isArray(error) ? error as Record<string, unknown> : {};
  const providerError = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
    ? record.error as Record<string, unknown> : record;
  const code = typeof providerError.code === 'number' ? providerError.code : null;
  const transient = status === 429 || status >= 500 || code === 4 || code === 17 || code === 32 || code === 613;
  if (status === 401 || code === 190) return { message: 'Meta authorization expired. Reconnect the account before retrying.', retryable: false };
  if (status === 403 || code === 10 || code === 200) return { message: 'Meta denied publishing. Check account permissions and Page access.', retryable: false };
  if (transient) return { message: 'Meta is temporarily unavailable or rate-limited. The CRM will retry safely.', retryable: true };
  return { message: 'Meta rejected this post. Review the content and connected account before retrying.', retryable: false };
}

async function graphRequest<T>(
  config: MetaGraphConfig,
  token: string,
  path: string,
  options: { method: 'GET' | 'POST'; parameters?: Record<string, string>; form?: Record<string, string>; uncertainOnNetworkFailure?: boolean },
): Promise<T> {
  const url = graphUrl(config, path, options.method === 'GET' ? options.parameters : undefined);
  const proof = createHmac('sha256', config.appSecret).update(token, 'utf8').digest('hex');
  url.searchParams.set('appsecret_proof', proof);
  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(options.form ? { body: new URLSearchParams(options.form) } : {}),
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new MetaPublishError(
      'Meta could not be reached. The CRM will not blindly repeat a possibly accepted post.',
      false,
      options.uncertainOnNetworkFailure === true,
    );
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new MetaPublishError('Meta returned an invalid response. Check the post status before retrying.', false, options.method === 'POST'); }
  if (!response.ok || !body || typeof body !== 'object' || Array.isArray(body) || 'error' in body) {
    const failure = safeProviderMessage(response.status, body);
    throw new MetaPublishError(failure.message, failure.retryable, false);
  }
  return body as T;
}

async function permalink(
  config: MetaGraphConfig,
  token: string,
  id: string,
): Promise<{ permalink: string | null; warning?: string }> {
  try {
    const result = await graphRequest<{ permalink_url?: unknown }>(config, token, id, {
      method: 'GET',
      parameters: { fields: 'permalink_url' },
    });
    if (typeof result.permalink_url !== 'string') return { permalink: null, warning: 'Published successfully, but Meta did not return a permalink. Use the provider ID to locate the post.' };
    const url = new URL(result.permalink_url);
    if (url.protocol !== 'https:') return { permalink: null, warning: 'Published successfully, but Meta returned an unsafe permalink. Use the provider ID to locate the post.' };
    return { permalink: url.toString() };
  } catch (error) {
    if (!(error instanceof MetaPublishError)) throw error;
    return { permalink: null, warning: 'Published successfully, but the permalink lookup failed. Use the provider ID to locate the post.' };
  }
}

export async function publishFacebookPagePost(
  config: MetaGraphConfig,
  token: string,
  pageId: string,
  content: MetaPublishContent,
): Promise<MetaPublishResult> {
  if (!/^[0-9]{1,32}$/.test(pageId) || !token || !content.caption.trim() && !content.linkUrl && !content.imageUrl) {
    throw new Error('Facebook post details are incomplete.');
  }
  let result: { id?: unknown; post_id?: unknown };
  if (content.imageUrl) {
    result = await graphRequest(config, token, `${pageId}/photos`, {
      method: 'POST',
      form: { url: content.imageUrl, caption: content.caption },
      uncertainOnNetworkFailure: true,
    });
  } else {
    result = await graphRequest(config, token, `${pageId}/feed`, {
      method: 'POST',
      form: {
        message: content.caption,
        ...(content.linkUrl ? { link: content.linkUrl } : {}),
      },
      uncertainOnNetworkFailure: true,
    });
  }
  const remoteId = typeof result.post_id === 'string' ? result.post_id : result.id;
  if (typeof remoteId !== 'string' || !/^[0-9_]{1,70}$/.test(remoteId)) {
    throw new MetaPublishError('Meta may have accepted the post but did not return a valid result ID. Check status before retrying.', false, true);
  }
  return { remoteId, ...await permalink(config, token, remoteId) };
}

export async function createInstagramImageContainer(
  config: MetaGraphConfig,
  token: string,
  instagramAccountId: string,
  content: MetaPublishContent,
): Promise<string> {
  if (!/^[0-9]{1,32}$/.test(instagramAccountId) || !token || !content.imageUrl || content.linkUrl) {
    throw new Error('Instagram publishing requires an image and a valid professional account.');
  }
  const result = await graphRequest<{ id?: unknown }>(config, token, `${instagramAccountId}/media`, {
    method: 'POST',
    form: { image_url: content.imageUrl, caption: content.caption },
    uncertainOnNetworkFailure: true,
  });
  if (typeof result.id !== 'string' || !/^[0-9_]{1,70}$/.test(result.id)) {
    throw new MetaPublishError('Meta did not return a valid Instagram media container ID.', false, true);
  }
  return result.id;
}

export async function getInstagramContainerState(
  config: MetaGraphConfig,
  token: string,
  containerId: string,
): Promise<InstagramContainerState> {
  if (!/^[0-9]{1,32}$/.test(containerId)) throw new Error('Instagram media container is invalid.');
  const result = await graphRequest<{ status_code?: unknown }>(config, token, containerId, {
    method: 'GET',
    parameters: { fields: 'status_code' },
  });
  if (result.status_code === 'IN_PROGRESS') return 'in_progress';
  if (result.status_code === 'FINISHED') return 'finished';
  if (result.status_code === 'ERROR') return 'error';
  if (result.status_code === 'EXPIRED') return 'expired';
  return 'unknown';
}

export async function publishInstagramContainer(
  config: MetaGraphConfig,
  token: string,
  instagramAccountId: string,
  containerId: string,
): Promise<MetaPublishResult> {
  if (!/^[0-9]{1,32}$/.test(instagramAccountId) || !/^[0-9]{1,32}$/.test(containerId) || !token) {
    throw new Error('Instagram publishing details are invalid.');
  }
  const result = await graphRequest<{ id?: unknown }>(config, token, `${instagramAccountId}/media_publish`, {
    method: 'POST',
    form: { creation_id: containerId },
    uncertainOnNetworkFailure: true,
  });
  if (typeof result.id !== 'string' || !/^[0-9]{1,32}$/.test(result.id)) {
    throw new MetaPublishError('Meta may have published the Instagram post but did not return a valid result ID. Check status before retrying.', false, true);
  }
  return { remoteId: result.id, ...await permalink(config, token, result.id) };
}
