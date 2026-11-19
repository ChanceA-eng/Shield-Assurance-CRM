import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { GET } from '../app/api/clients/[clientId]/files/[fileId]/download/route';
import { POST as startUpload } from '../app/api/clients/[clientId]/files/upload/route';
import { POST as completeUpload } from '../app/api/clients/[clientId]/files/upload/complete/route';
import { DELETE as deleteDocument, GET as listDocuments, PATCH as updateDocument } from '../app/api/clients/[clientId]/files/route';
import { issueUploadConfirmation } from './account-upload-access';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn(), apiActorName: vi.fn(() => 'QA agent') }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
const client = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const file = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const user: User = { id: client, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-02T00:00:00Z' };
const context = { params: Promise.resolve({ clientId: client, fileId: file }) };
const calls: URL[] = [];
const bytes = new Uint8Array([37, 80, 68, 70, 45, 0, 127, 255]);
let placeholder = false;
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  calls.length = 0; placeholder = false;
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'legacy' } });
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

it('requires both document and account access before requesting any data', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null,
    teamAccess: { mode: 'restricted', grants: { 'documents.view': 'agency' } } });
  expect((await GET(new NextRequest('http://localhost/download'), context)).status).toBe(403);
  expect((await listDocuments(new NextRequest('http://localhost/files'), context)).status).toBe(403);
  expect(calls).toHaveLength(0);
});

it('applies the narrower assignment scope to lists and downloads before accessing storage', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null,
    teamAccess: { mode: 'restricted', grants: { 'accounts.view': 'assigned', 'documents.view': 'agency' } } });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(url.pathname).toBe('/rest/v1/client_files');
    expect(url.searchParams.get('select')).toContain('account:clients!client_files_client_id_fkey!inner()');
    expect(url.searchParams.get('account.agent_user_id')).toBe(`eq.${user.id}`);
    return Response.json([]);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
  const list = await listDocuments(new NextRequest('http://localhost/files'), context);
  expect(await list.json()).toEqual([]);
  expect((await GET(new NextRequest('http://localhost/download'), context)).status).toBe(404);
  expect(calls).toHaveLength(2);
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

it('binds completion to the actor and original file and rechecks assignment before touching storage', async () => {
  const key = 'synthetic-test-signing-key-not-a-credential';
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', key);
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted',
    grants: { 'accounts.view': 'agency', 'documents.view': 'assigned', 'documents.edit': 'agency' } } });
  const path = `clients/${client}/${file}/coverage.pdf`;
  const upload = { actor: user.id, path, fileName: 'Coverage.pdf', contentType: 'application/pdf', size: bytes.length };
  const valid = issueUploadConfirmation(key, upload);
  const request = (confirmation: string, size = bytes.length) => new NextRequest('http://localhost/complete', {
    method: 'POST', body: JSON.stringify({ storage_path: path, file_name: upload.fileName,
      content_type: upload.contentType, file_size: size, confirmation }),
  });
  expect((await completeUpload(request(issueUploadConfirmation(key, { ...upload, actor: file })), context)).status).toBe(403);
  expect((await completeUpload(request(valid, bytes.length + 1), context)).status).toBe(403);
  expect((await completeUpload(request(issueUploadConfirmation(key, upload, Date.now() - 3 * 3600000)), context)).status).toBe(403);
  expect(calls).toHaveLength(0);

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    expect(url.pathname).toBe('/rest/v1/clients');
    expect(url.searchParams.get('agent_user_id')).toBe(`eq.${user.id}`);
    return Response.json([]);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
  expect((await completeUpload(request(valid), context)).status).toBe(404);
  expect(calls).toHaveLength(1);
});

it('allows authorized assigned staff to issue and confirm an upload without unscoped account access', async () => {
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-test-signing-key-not-a-credential');
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: { mode: 'restricted',
    grants: { 'accounts.view': 'assigned', 'documents.view': 'agency', 'documents.edit': 'agency' } } });
  let uploadedPath = '';
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname === '/rest/v1/clients') {
      expect(url.searchParams.get('id')).toBe(`eq.${client}`);
      expect(url.searchParams.get('agent_user_id')).toBe(`eq.${user.id}`);
      return Response.json([{ id: client }]);
    }
    if (url.pathname.startsWith('/storage/v1/object/upload/sign/account-documents/')) {
      uploadedPath = url.pathname.split('/account-documents/')[1];
      return Response.json({ url: `/object/upload/sign/account-documents/${uploadedPath}?token=synthetic` });
    }
    if (url.pathname.startsWith('/storage/v1/object/list/')) {
      return Response.json([{ name: 'coverage.pdf', metadata: { size: bytes.length, mimetype: 'application/pdf' } }]);
    }
    expect(url.pathname).toBe('/rest/v1/client_files');
    expect(init?.method).toBe('POST');
    return Response.json({ id: file, ...JSON.parse(String(init?.body))[0] });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false },
  }));
  const upload = { file_name: 'Coverage.pdf', content_type: 'application/pdf', file_size: bytes.length };
  const issued = await startUpload(new NextRequest('http://localhost/upload', { method: 'POST', body: JSON.stringify(upload) }), context);
  expect(issued.status).toBe(201);
  const ticket = (await issued.json()).upload;
  expect(ticket.storage_path).toBe(uploadedPath);
  const completed = await completeUpload(new NextRequest('http://localhost/complete', { method: 'POST',
    body: JSON.stringify({ ...upload, storage_path: ticket.storage_path, confirmation: ticket.confirmation }) }), context);
  expect(completed.status).toBe(201);
  expect(calls.filter((url) => url.pathname === '/rest/v1/clients')).toHaveLength(2);
});

it('retains placement evidence bytes when the database rejects deletion', async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    if (url.pathname.endsWith('/claim_document_deletion')) return Response.json({ code: '23514', message: 'Document retained as policy evidence.' }, { status: 409 });
    expect(url.pathname.startsWith('/storage/')).toBe(false);
    return Response.json({ id: file, client_id: client, metadata: { source_kind: 'stored', storage: { bucket: 'account-documents', path: `clients/${client}/${file}/coverage.pdf` } } });
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
  const response = await deleteDocument(new NextRequest('http://localhost/files', { method: 'DELETE', body: JSON.stringify({ id: file }) }), context);
  expect(response.status).toBe(409);
  expect(calls).toHaveLength(2);
  expect(calls.some((url) => url.pathname.startsWith('/storage/'))).toBe(false);
});

it('persists reviewed fields on the private source and updates them without replacing storage metadata', async () => {
  const path = `clients/${client}/${file}/coverage.pdf`;
  const fields = { full_name: 'Synthetic LLC', coverage_limits: 'Each occurrence: $1,000,000',
    deductibles: 'Collision: $500', vehicles: '2023 Ford Transit\n2022 Toyota Camry' };
  let record = { id: file, client_id: client, file_name: 'Coverage.pdf', file_url: null, file_size: bytes.length,
    metadata: { source_kind: 'stored', storage: { bucket: 'account-documents', path, content_type: 'application/pdf', size: bytes.length } } };
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.startsWith('/storage/')) return Response.json([{ name: 'coverage.pdf', metadata: { size: bytes.length, mimetype: 'application/pdf' } }]);
    if (init?.method === 'POST' || init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body)) as typeof record | Array<typeof record>;
      record = { ...record, ...(Array.isArray(body) ? body[0] : body) };
      expect(record.metadata.storage.path).toBe(path);
    }
    return Response.json(record);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', { global: { fetch: fetcher }, auth: { persistSession: false } }));
  const result = await completeUpload(new NextRequest('http://localhost/complete', { method: 'POST', body: JSON.stringify({
    storage_path: path, file_name: 'Coverage.pdf', file_size: bytes.length, content_type: 'application/pdf', intake_review: fields,
  }) }), context);
  expect(result.status).toBe(201);
  expect(await result.json()).toMatchObject({ intake_review: fields, source_kind: 'stored' });
  const updatedFields = { ...fields, deductibles: 'Collision: $1,000' };
  const update = await updateDocument(new NextRequest('http://localhost/files', { method: 'PATCH',
    body: JSON.stringify({ id: file, intake_review: updatedFields }) }), context);
  expect(update.status).toBe(200);
  expect(await update.json()).toMatchObject({ intake_review: updatedFields, source_kind: 'stored' });
  const invalid = await updateDocument(new NextRequest('http://localhost/files', { method: 'PATCH',
    body: JSON.stringify({ id: file, intake_review: { secret: 'unsupported' } }) }), context);
  expect(invalid.status).toBe(400);
});
