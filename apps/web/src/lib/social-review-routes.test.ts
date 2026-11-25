import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../app/api/social-marketing/reviews/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const actor = '04865539-8320-4031-93de-8047f715f748';
const user: User = { id: actor, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '2026-11-05T12:00:00Z' };
const command = { id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d', action: 'approve', expected_revision: 2, expected_review_version: 1 };
let calls: Record<string, unknown>[];
let response: unknown;
let status: number;
const request = (body: unknown): NextRequest => new NextRequest('https://crm.invalid/api/social-marketing/reviews', { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  calls = []; response = { review_state: 'approved' }; status = 200;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: async (_input, init) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } });
    } }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});
describe('Social review API', () => {
  it('requires session and rejects spoofed actor', async () => {
    expect((await POST(request({ ...command, p_actor: actor }))).status).toBe(400);
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) });
    expect((await POST(request(command))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('passes verified actor and both versions to the database', async () => {
    expect((await POST(request(command))).status).toBe(200);
    expect(calls[0]).toEqual({ p_actor: actor, p_id: command.id, p_action: 'approve', p_expected_revision: 2, p_expected_review_version: 1, p_reason: '' });
  });
  it('separates editor review requests from approval authority', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted', grants: { 'social.edit': 'agency' } } });
    for (const action of ['submit', 'withdraw']) expect((await POST(request({ ...command, action }))).status).toBe(200);
    for (const action of ['approve', 'request_changes']) expect((await POST(request({ ...command, action, reason: 'Changes needed' }))).status).toBe(403);
    vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted', grants: { 'social.approve': 'agency' } } });
    expect((await POST(request(command))).status).toBe(200);
    expect((await POST(request({ ...command, action: 'withdraw' }))).status).toBe(403);
    expect(calls.map((body) => body.p_action)).toEqual(['submit', 'withdraw', 'approve']);
  });
  it.each([['42501',403],['PT409',409],['22023',400]])('surfaces authorization/state failures %s', async (code, expected) => {
    response = { code, message: 'This review is not allowed. Reload the post.' }; status = Number(expected);
    expect((await POST(request(command))).status).toBe(Number(expected));
  });
  it('does not claim approval if confirmation is missing', async () => {
    response = null;
    expect((await POST(request(command))).status).toBe(500);
  });
});
