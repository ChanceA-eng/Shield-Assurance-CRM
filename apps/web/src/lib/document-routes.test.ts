import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET } from '../app/api/clients/[clientId]/files/[fileId]/download/route';
import { POST as completeUpload } from '../app/api/clients/[clientId]/files/upload/complete/route';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), apiActorName: vi.fn(() => 'QA agent') }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const client = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const file = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const user: User = { id: client, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' };
const context = { params: Promise.resolve({ clientId: client, fileId: file }) };
const calls: URL[] = [];
const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 127, 255]);
let placeholder = false;
beforeEach(() => {
  calls.length = 0; placeholder = false;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url); calls.push(url);
    if (url.pathname.startsWith('/storage/')) return new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } });
    return new Response(JSON.stringify({ id: file, client_id: client, file_name: 'Coverage.pdf', file_url: placeholder ? 'local-upload://coverage.pdf' : null,
      metadata: placeholder ? {} : { source_kind: 'stored', storage: { bucket: 'account-documents', path: `clients/${client}/${file}/coverage.pdf`, content_type: 'application/pdf', size: bytes.length } } }), { headers: { 'Content-Type': 'application/json' } });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
});
it('returns exact stored bytes with private download headers and account-scoped lookup', async () => {
  const response = await GET(new NextRequest('http://localhost/download'), context);
  expect(response.status).toBe(200);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(response.headers.get('Content-Disposition')).toContain('attachment');
  expect(calls[0].searchParams.get('client_id')).toBe(`eq.${client}`);
});
it('does not download fake legacy files or bypass authentication', async () => {
  placeholder = true;
  expect((await GET(new NextRequest('http://localhost/download'), context)).status).toBe(409);
  expect(calls).toHaveLength(1);
  calls.length = 0;
  vi.mocked(getApiSession).mockResolvedValue({ user: null, error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) });
  expect((await GET(new NextRequest('http://localhost/download'), context)).status).toBe(401);
  expect(calls).toHaveLength(0);
});

it('recovers the exact already-recorded upload without deleting bytes or duplicating metadata', async () => {
  const path = `clients/${client}/${file}/coverage.pdf`;
  const request = (): NextRequest => new NextRequest('http://localhost/complete', { method: 'POST', body: JSON.stringify({
    storage_path: path, file_name: 'Coverage.pdf', file_size: bytes.length, content_type: 'application/pdf',
  }) });
  let recordedSize = bytes.length;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    const method = init?.method ?? 'GET';
    expect(method).not.toBe('DELETE');
    if (url.pathname.startsWith('/storage/')) return Response.json([{ name: 'coverage.pdf', metadata: { size: bytes.length, mimetype: 'application/pdf' } }]);
    if (method === 'POST') return Response.json({ code: '23505', message: 'duplicate storage path' }, { status: 409 });
    expect(url.searchParams.get('client_id')).toBe(`eq.${client}`);
    expect(url.searchParams.get('metadata->storage->>path')).toBe(`eq.${path}`);
    return Response.json([{ id: file, client_id: client, file_name: 'Coverage.pdf', file_url: null, file_size: recordedSize,
      metadata: { source_kind: 'stored', storage: { bucket: 'account-documents', path, content_type: 'application/pdf', size: recordedSize } } }]);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
  const response = await completeUpload(request(), { params: Promise.resolve({ clientId: client }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ id: file, source_kind: 'stored' });
  recordedSize++;
  expect((await completeUpload(request(), { params: Promise.resolve({ clientId: client }) })).status).toBe(409);
});
