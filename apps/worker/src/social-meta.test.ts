import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createInstagramImageContainer,
  getInstagramContainerState,
  MetaPublishError,
  publishFacebookPagePost,
  publishInstagramContainer,
} from './social-meta.js';

const config = { graphVersion: 'v27.0', appSecret: 'test-secret' };
const token = 'never-log-this-token';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Meta publishing adapter', () => {
  it('publishes Facebook text/link content and captures the remote result', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ id: '123_456' }))
      .mockResolvedValueOnce(response({ permalink_url: 'https://www.facebook.com/123_456' }));
    vi.stubGlobal('fetch', fetch);
    await expect(publishFacebookPagePost(config, token, '123', {
      caption: 'Coverage update', linkUrl: 'https://example.com', imageUrl: null,
    })).resolves.toEqual({ remoteId: '123_456', permalink: 'https://www.facebook.com/123_456' });
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v27.0/123/feed');
    expect(String(init.body)).toContain('message=Coverage+update');
    expect(String(init.body)).toContain('link=https%3A%2F%2Fexample.com');
    expect(url.searchParams.get('access_token')).toBeNull();
    expect(init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  });

  it('publishes a Facebook image with the caption in the photo request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ id: '789_321' }))
      .mockResolvedValueOnce(response({ permalink_url: 'https://www.facebook.com/789_321' }));
    vi.stubGlobal('fetch', fetch);
    await expect(publishFacebookPagePost(config, token, '789', {
      caption: 'New photo', linkUrl: null, imageUrl: 'https://storage.example/signed.jpg',
    })).resolves.toMatchObject({ remoteId: '789_321' });
    const [url, init] = fetch.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v27.0/789/photos');
    expect(String(init.body)).toContain('url=https%3A%2F%2Fstorage.example%2Fsigned.jpg');
    expect(String(init.body)).toContain('caption=New+photo');
  });

  it('uses the Instagram container, processing, then publish sequence', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(response({ id: '555' }))
      .mockResolvedValueOnce(response({ status_code: 'IN_PROGRESS' }))
      .mockResolvedValueOnce(response({ id: '777' }))
      .mockResolvedValueOnce(response({ permalink_url: 'https://www.instagram.com/p/abc/' }));
    vi.stubGlobal('fetch', fetch);
    const containerId = await createInstagramImageContainer(config, token, '111', {
      caption: 'Image caption', linkUrl: null, imageUrl: 'https://storage.example/signed.jpg',
    });
    expect(containerId).toBe('555');
    await expect(getInstagramContainerState(config, token, containerId)).resolves.toBe('in_progress');
    await expect(publishInstagramContainer(config, token, '111', containerId))
      .resolves.toEqual({ remoteId: '777', permalink: 'https://www.instagram.com/p/abc/' });
    expect(fetch.mock.calls.map(([url]) => (url as URL).pathname)).toEqual([
      '/v27.0/111/media', '/v27.0/555', '/v27.0/111/media_publish', '/v27.0/777',
    ]);
  });

  it('marks a lost publishing acknowledgement uncertain instead of retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(publishFacebookPagePost(config, token, '123', {
      caption: 'Possible post', linkUrl: null, imageUrl: null,
    })).rejects.toMatchObject({ retryable: false, uncertain: true });
  });

  it('maps permission and rate-limit errors to safe actionable results', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ error: { code: 200, message: token } }, 403))
      .mockResolvedValueOnce(response({ error: { code: 17, message: token } }, 400)));
    await expect(publishInstagramContainer(config, token, '123', '456'))
      .rejects.toThrow('Check account permissions');
    try {
      await publishInstagramContainer(config, token, '123', '456');
      throw new Error('Expected rate-limit failure.');
    } catch (error) {
      expect(error).toBeInstanceOf(MetaPublishError);
      expect(error).toMatchObject({ retryable: true, uncertain: false });
      expect((error as Error).message).not.toContain(token);
    }
  });
});
