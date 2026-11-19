import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { getApiSession } from '../../../../lib/api-auth';
import { requireAgencyOwner } from '../../../../lib/agency-access';
import { emailConnectionStatus } from '../../../../lib/email-setup';
import { WorkspaceError } from '../../../../lib/record-scope';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';

vi.mock('../../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../../lib/agency-access', () => ({ requireAgencyOwner: vi.fn() }));
vi.mock('../../../../lib/email-setup', () => ({ emailConnectionStatus: vi.fn() }));
vi.mock('../../../../lib/supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: '00000000-0000-4000-8000-000000000001' } as User, error: null });
  vi.mocked(getSupabaseServerClient).mockReturnValue({} as SupabaseClient);
});

describe('integration status authorization', () => {
  it('requires an authenticated API session before checking providers', async () => {
    vi.mocked(getApiSession).mockResolvedValue({
      user: null,
      error: NextResponse.json({ message: 'Sign in required.' }, { status: 401 }),
    });
    const response = await GET(new NextRequest('http://localhost/api/settings/integrations'));
    expect(response.status).toBe(401);
    expect(requireAgencyOwner).not.toHaveBeenCalled();
    expect(emailConnectionStatus).not.toHaveBeenCalled();
  });

  it('restricts provider details to active owners', async () => {
    vi.mocked(requireAgencyOwner).mockRejectedValue(new WorkspaceError('Owner access required.', 403));
    const response = await GET(new NextRequest('http://localhost/api/settings/integrations'));
    expect(response.status).toBe(403);
    expect(emailConnectionStatus).not.toHaveBeenCalled();
  });
});
