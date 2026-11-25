import { createClient, type User } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from '../app/api/sales-templates/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { listSalesTemplates, salesFacts, suggestedSalesTemplates } from './sales-templates';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./sales-templates', () => ({
  listSalesTemplates: vi.fn(), parseSalesTemplate: vi.fn(), salesFacts: vi.fn(), mergeSalesFacts: vi.fn(),
  renderSalesTemplate: vi.fn(), suggestedSalesTemplates: vi.fn(),
}));

const user: User = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated',
  app_metadata: {}, user_metadata: {}, created_at: '' };
const conversation = 'lead:10000000-0000-4000-8000-000000000002';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: {
    mode: 'restricted', grants: { 'content.view': 'agency', 'content.edit': 'agency' },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false },
  }));
  vi.mocked(listSalesTemplates).mockResolvedValue([]);
  vi.mocked(salesFacts).mockResolvedValue({});
  vi.mocked(suggestedSalesTemplates).mockResolvedValue([]);
});

it('allows marketing to see reusable templates without reading conversation facts', async () => {
  const response = await GET(new NextRequest('https://crm.example.invalid/api/sales-templates'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ canManage: true, canArchive: false });
  expect(listSalesTemplates).toHaveBeenCalledOnce();
});

it('advertises archive access only when explicitly granted', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: {
    mode: 'restricted', grants: { 'content.view': 'agency', 'content.edit': 'agency', 'content.delete': 'agency' },
  } });
  const response = await GET(new NextRequest('https://crm.example.invalid/api/sales-templates'));
  expect(await response.json()).toMatchObject({ canManage: true, canArchive: true });
});

it('denies template facts and rendering without conversation and record permissions', async () => {
  const get = await GET(new NextRequest(`https://crm.example.invalid/api/sales-templates?conversation=${conversation}`));
  const post = await POST(new NextRequest('https://crm.example.invalid/api/sales-templates', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ confirmed: true, conversation, channel: 'email' }),
  }));
  expect(get.status).toBe(403);
  expect(post.status).toBe(403);
  expect(listSalesTemplates).not.toHaveBeenCalled();
});

it('does not expose a conversation merely because message viewing is agency-wide', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: {
    mode: 'restricted', grants: { 'content.view': 'agency', 'messages.view': 'agency', 'leads.view': 'assigned' },
  } });
  const response = await GET(new NextRequest(`https://crm.example.invalid/api/sales-templates?conversation=${conversation}`));
  expect(response.status).toBe(403);
});

it('allows conversation facts when agency-wide message and record access are both granted', async () => {
  vi.mocked(getApiSession).mockResolvedValue({ user, error: null, teamAccess: {
    mode: 'restricted', grants: { 'content.view': 'agency', 'messages.view': 'agency', 'leads.view': 'agency' },
  } });
  const response = await GET(new NextRequest(`https://crm.example.invalid/api/sales-templates?conversation=${conversation}`));
  expect(response.status).toBe(200);
  expect(salesFacts).toHaveBeenCalledOnce();
});
