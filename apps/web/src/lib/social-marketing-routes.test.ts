import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET, POST } from '../app/api/social-marketing/drafts/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const id = '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d';
const actor = '04865539-8320-4031-93de-8047f715f748';
const user: User = { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-05T12:00:00Z' };
const calls: Array<{ url: URL; body: Record<string, unknown> }> = [];
let reply: unknown;
let httpStatus: number;
function request(method: string, body?: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/social-marketing/drafts${query}`, {
    method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });
}
beforeEach(() => {
  calls.length = 0; reply = { id, revision: 1 }; httpStatus = 200;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  const fetcher: typeof fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify(reply), { status: httpStatus, headers: { 'Content-Type': 'application/json' } });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }));
});
describe('Social marketing routes', () => {
  it('authenticates before any database access', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) });
    expect((await GET(request('GET'))).status).toBe(401);
    expect((await POST(request('POST', {}))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('reads through an actor-checked command and disables caching', async () => {
    reply = { posts: [], total: 0 };
    const result = await GET(request('GET', undefined, '?status=archived&offset=50'));
    expect(result.status).toBe(200);
    expect(result.headers.get('cache-control')).toContain('no-store');
    expect(calls[0].url.pathname).toBe('/rest/v1/rpc/list_social_drafts');
    expect(calls[0].body).toEqual({ p_actor: actor, p_status: 'archived', p_offset: 50, p_id: null });
  });
  it('passes only the verified actor and normalized content', async () => {
    expect((await POST(request('POST', { action: 'create', id, title: ' Idea ', caption: '' }))).status).toBe(201);
    expect(calls[0].body).toEqual({ p_actor: actor, p_id: id, p_action: 'create', p_title: 'Idea', p_caption: '', p_link_url: null, p_expected_revision: null });
  });
  it('requires separate archive access and keeps readers read-only', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted',
      grants: { 'social.view': 'agency', 'social.edit': 'agency' } } });
    expect((await POST(request('POST', { action: 'create', id, title: 'Idea', caption: '' }))).status).toBe(201);
    expect((await POST(request('POST', { action: 'update', id, title: 'Updated', caption: '', expected_revision: 1 }))).status).toBe(200);
    expect((await POST(request('POST', { action: 'archive', id, expected_revision: 2 }))).status).toBe(403);
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted',
      grants: { 'social.view': 'agency', 'social.edit': 'agency', 'social.delete': 'agency' } } });
    expect((await POST(request('POST', { action: 'archive', id, expected_revision: 2 }))).status).toBe(200);
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted',
      grants: { 'social.view': 'agency' } } });
    expect((await POST(request('POST', { action: 'create', id, title: 'Idea', caption: '' }))).status).toBe(403);
    expect(calls.map(({ body }) => body.p_action)).toEqual(['create', 'update', 'archive']);
  });
  it('passes versioned attachment changes and preserves omitted legacy attachments', async () => {
    expect((await POST(request('POST', { action: 'update', id, title: 'Idea', caption: '', expected_revision: 1, media_ids: [id] }))).status).toBe(200);
    expect(calls[0].body).toMatchObject({ p_media_ids: [id], p_expected_revision: 1, p_link_url: null });
    calls.length = 0;
    expect((await POST(request('POST', { action: 'update', id, title: 'Idea', caption: '', expected_revision: 2 }))).status).toBe(200);
    expect(calls[0].body).not.toHaveProperty('p_media_ids');
  });
  it('rejects spoofed actor/workspace fields and publication commands', async () => {
    for (const extra of [{ actor }, { workspace_id: id }, { action: 'publish' }]) {
      expect((await POST(request('POST', { action: 'create', id, title: 'Idea', caption: '', ...extra }))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });
  it('requires an optimistic revision and never silently overwrites conflicts', async () => {
    expect((await POST(request('POST', { action: 'update', id, title: 'Idea', caption: '' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
    reply = { code: 'PT409', message: 'Someone else changed this draft. Reload before saving.' }; httpStatus = 409;
    const result = await POST(request('POST', { action: 'update', id, title: 'Idea', caption: '', expected_revision: 1 }));
    expect(result.status).toBe(409);
    expect(calls[0].body.p_expected_revision).toBe(1);
  });
  it('surfaces membership denial and missing schema explicitly', async () => {
    reply = { code: '42501', message: 'Active agency membership is required.' }; httpStatus = 403;
    expect((await GET(request('GET'))).status).toBe(403);
    reply = { code: 'PGRST202', message: 'Function missing from schema cache.' }; httpStatus = 404;
    const result = await GET(request('GET'));
    expect(result.status).toBe(503);
    expect(await result.json()).toMatchObject({ message: expect.stringContaining('20261106040000') });
  });
  it('does not return success when the database returns null', async () => {
    reply = null;
    expect((await GET(request('GET'))).status).toBe(500);
    expect((await POST(request('POST', { action: 'archive', id, expected_revision: 2 }))).status).toBe(500);
  });
  it.each(['?status=published', '?offset=-1', '?offset=1.5', '?offset=2147483648', '?id=wrong'])('rejects malformed filters %s', async (query) => {
    expect((await GET(request('GET', undefined, query))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
