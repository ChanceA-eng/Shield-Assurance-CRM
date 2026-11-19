import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type User } from '@supabase/supabase-js';
import { CAPTION_STARTERS, captionSuggestionInput, parseCaptionSuggestions } from './social-captions';
import { GET, POST } from '../app/api/social-marketing/captions/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { requestJsonChat } from './ai-json-chat';
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./ai-json-chat', () => ({ requestJsonChat: vi.fn() }));
const actor = '04865539-8320-4031-93de-8047f715f748';
const user: User = { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-05T12:00:00Z' };
const request = (body: unknown): NextRequest => new NextRequest('https://crm.invalid/api/social-marketing/captions', { method: 'POST', body: JSON.stringify(body) });
let access: unknown;
let status: number;
let calls: Record<string, unknown>[];
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('OPENAI_API_KEY', 'test-key');
  access = { assets: [], total: 0 }; status = 200; calls = [];
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(requestJsonChat).mockResolvedValue(JSON.stringify({ captions: ['Review your options.', 'Have a question? Ask our team.', 'Insurance starts with a conversation.'] }));
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(access), { status, headers: { 'Content-Type': 'application/json' } });
    } }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});
afterEach(() => vi.unstubAllEnvs());
describe('Caption help', () => {
  it('has distinct, usable credit-free starters', () => {
    expect(CAPTION_STARTERS).toHaveLength(4);
    expect(new Set(CAPTION_STARTERS.map((starter) => starter.text)).size).toBe(4);
    for (const starter of CAPTION_STARTERS) expect(starter.text.length).toBeLessThan(1000);
    expect(requestJsonChat).not.toHaveBeenCalled();
  });
  it.each([{}, { topic: 't', caption: '', actor }, { topic: 't', caption: 'x'.repeat(2001) }, { topic: 't\0', caption: '' }])('rejects invalid input without AI usage', async (body) => {
    expect(() => captionSuggestionInput(body)).toThrow();
    expect((await POST(request(body))).status).toBe(400);
    expect(requestJsonChat).not.toHaveBeenCalled();
  });
  it('checks availability without generating or exposing a key', async () => {
    const response = await GET(new NextRequest('https://crm.invalid/api/social-marketing/captions'));
    expect(await response.json()).toEqual({ available: true });
    expect(requestJsonChat).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });
  it('requires authentication before availability or generation', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) });
    expect((await POST(request({ topic: 'Review', caption: '' }))).status).toBe(401);
    expect((await GET(new NextRequest('https://crm.invalid/api/social-marketing/captions'))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('requires verified membership before charging for suggestions', async () => {
    access = { code: '42501', message: 'An active membership is required.' }; status = 403;
    expect((await POST(request({ topic: 'Review', caption: '' }))).status).toBe(403);
    expect(requestJsonChat).not.toHaveBeenCalled();
  });
  it('returns an actionable missing-provider error, not fake captions', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    expect((await POST(request({ topic: 'Review', caption: '' }))).status).toBe(503);
    expect(requestJsonChat).not.toHaveBeenCalled();
  });
  it('uses only supplied public topic/caption and does not save a draft', async () => {
    const response = await POST(request({ topic: 'Coverage review', caption: 'Talk to our team.' }));
    expect(response.status).toBe(200);
    expect((await response.json()).captions).toHaveLength(3);
    expect(calls).toEqual([{ p_actor: actor, p_id: null, p_offset: 0 }]);
    expect(vi.mocked(requestJsonChat).mock.calls[0][0][1].content).toBe(JSON.stringify({ topic: 'Coverage review', caption: 'Talk to our team.' }));
  });
  it.each(['not JSON', '{"captions":["one"]}', '{"captions":["a","a","a"]}', '{"captions":["a","b",42]}'])('rejects invalid provider output %s', (raw) => {
    expect(() => parseCaptionSuggestions(raw)).toThrow();
  });
  it('surfaces provider failure and allows another explicit attempt', async () => {
    vi.mocked(requestJsonChat).mockResolvedValueOnce(null);
    expect((await POST(request({ topic: 'Review', caption: '' }))).status).toBe(503);
    expect((await POST(request({ topic: 'Review', caption: '' }))).status).toBe(200);
    expect(requestJsonChat).toHaveBeenCalledTimes(2);
  });
  it('rejects simultaneous requests from the same actor without a second AI call', async () => {
    let finish: (value: string) => void = () => { throw new Error('Request not started.'); };
    vi.mocked(requestJsonChat).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = POST(request({ topic: 'Review', caption: '' }));
    await vi.waitFor(() => expect(requestJsonChat).toHaveBeenCalledTimes(1));
    expect((await POST(request({ topic: 'Review', caption: '' }))).status).toBe(429);
    finish('{"captions":["a","b","c"]}');
    expect((await first).status).toBe(200);
  });
});
