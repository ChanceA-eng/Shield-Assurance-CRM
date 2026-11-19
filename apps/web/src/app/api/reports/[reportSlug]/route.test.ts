import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

vi.mock('../../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../../lib/supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

const context = { params: Promise.resolve({ reportSlug: 'production' }) };
const request = (query = '') => new NextRequest(`http://localhost/api/reports/production${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: '00000000-0000-4000-8000-000000000001' } as User, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue(null);
});

describe('report detail route validation', () => {
  it('requires an authenticated API session', async () => {
    const unauthorized = NextResponse.json({ message: 'Sign in required.' }, { status: 401 });
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: unauthorized });
    const response = await GET(request(), context);
    expect(response.status).toBe(401);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('rejects unknown report slugs', async () => {
    const response = await GET(new NextRequest('http://localhost/api/reports/unknown'), {
      params: Promise.resolve({ reportSlug: 'unknown' }),
    });
    expect(response.status).toBe(404);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it.each([
    ['?range=invalid', 'reporting period'],
    ['?page=0', 'report page'],
    ['?carrier=', 'carrier filter'],
    ['?format=json', 'report format'],
  ])('rejects invalid filters %s', async (query, expected) => {
    const response = await GET(request(query), context);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain(expected);
    expect(getSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('reports an unavailable database instead of returning an empty report', async () => {
    const response = await GET(request(), context);
    expect(response.status).toBe(503);
  });
});
