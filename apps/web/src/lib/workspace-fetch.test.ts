import { afterEach, describe, expect, it, vi } from 'vitest';
import { workspacePage } from './workspace-fetch';

describe('progressive conversation pages', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('returns rows and the next offset without fetching the entire conversation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'latest' }]), { headers: { 'X-Next-Offset': '100' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await workspacePage('/api/communication-log?client_id=fixture&limit=100')).toEqual({ rows: [{ id: 'latest' }], nextOffset: 100 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/communication-log?client_id=fixture&limit=100', { cache: 'no-store' });
  });
  it('stops paging when the server reports the end', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { headers: { 'X-Next-Offset': '' } })));
    expect(await workspacePage('/api/communication-log')).toEqual({ rows: [], nextOffset: null });
  });
  it('surfaces failed older-page reads rather than replacing the existing history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Earlier messages are unavailable."}', { status: 503 })));
    await expect(workspacePage('/api/communication-log')).rejects.toThrow('Earlier messages are unavailable.');
  });
  it('rejects invalid message-list shapes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"items":[]}')));
    await expect(workspacePage('/api/communication-log')).rejects.toThrow('invalid message page');
  });
  it.each(['-1', 'offset', '1.5'])('rejects invalid next-page offsets (%s)', async (offset) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { headers: { 'X-Next-Offset': offset } })));
    await expect(workspacePage('/api/communication-log')).rejects.toThrow('invalid message paging');
  });
});
