import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJsonChat } from './ai-json-chat';
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('Shared AI JSON adapter', () => {
  it('does not call a provider without configuration', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(requestJsonChat([], 100)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('not configured') });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('preserves existing model and bounded JSON request behavior', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key'); vi.stubEnv('OUTREACH_CHAT_MODEL', 'test-model');
    const fetch = vi.fn().mockResolvedValue(new Response('{"choices":[{"message":{"content":"{}"}}]}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    expect(await requestJsonChat([{ role: 'user', content: 'Public topic' }], 1000)).toBe('{}');
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: 'test-model', max_tokens: 1000, response_format: { type: 'json_object' } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(['{}', '{"choices":[{"message":{"content":42}}]}'])('rejects unusable responses', async (body) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
    expect(await requestJsonChat([], 100)).toBeNull();
  });
  it.each([
    [401, 'invalid_api_key', 503, 'rejected access'],
    [403, 'permission_denied', 503, 'project permissions'],
    [429, 'insufficient_quota', 503, 'billing and project limits'],
    [429, 'rate_limit_exceeded', 429, 'too many requests'],
    [404, 'model_not_found', 503, 'configured AI model'],
    [503, 'server_error', 503, 'temporarily unavailable'],
  ])('reports provider failure %i without blaming missing configuration', async (status, code, expectedStatus, text) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const fetch = vi.fn().mockResolvedValue(Response.json({ error: { code, message: 'Private provider details' } }, { status }));
    vi.stubGlobal('fetch', fetch);
    await expect(requestJsonChat([], 100)).rejects.toMatchObject({ status: expectedStatus, message: expect.stringContaining(text) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [new DOMException('Private timeout detail', 'TimeoutError'), 504, 'timed out'],
    [new TypeError('Private network detail'), 503, 'could not reach'],
  ])('distinguishes timeouts from connection errors', async (error, status, text) => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(requestJsonChat([], 100)).rejects.toMatchObject({ status, message: expect.stringContaining(text) });
  });
  it('reports a non-JSON upstream outage without exposing its body', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Private outage details</html>', { status: 502 })));
    await expect(requestJsonChat([], 100)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('temporarily unavailable') });
  });
});
