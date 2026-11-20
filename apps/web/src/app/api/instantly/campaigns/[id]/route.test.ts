import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  session: vi.fn(),
  activate: vi.fn(),
  pause: vi.fn(),
}));

vi.mock('../../../../../lib/api-auth', () => ({ getApiSession: mocks.session }));
vi.mock('../../../../../lib/supabase-server', () => ({ getSupabaseServerClient: mocks.getDb }));
vi.mock('../../../../../lib/instantly', async (original) => ({
  ...await original<typeof import('../../../../../lib/instantly')>(),
  activateInstantlyCampaign: mocks.activate,
  pauseInstantlyCampaign: mocks.pause,
}));

import { InstantlyApiError } from '../../../../../lib/instantly';
import { POST } from './route';

interface Result {
  data: { id: string; status?: string; provider_campaign_id?: string } | null;
  error: { message: string; code: string } | null;
}

let results: Result[];
let updates: ReturnType<typeof vi.fn>;

function setup(status: string): void {
  results = [
    { data: { id: 'campaign', status, provider_campaign_id: 'provider-campaign' }, error: null },
    { data: { id: 'campaign' }, error: null },
    { data: null, error: null },
  ];
  updates = vi.fn();
  mocks.getDb.mockReturnValue({
    from: vi.fn(() => {
      const result = results.shift();
      if (!result) throw new Error('Unexpected database call.');
      const promise = Promise.resolve(result);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        update: vi.fn((values: Record<string, unknown>) => {
          updates(values);
          return query;
        }),
        maybeSingle: vi.fn(() => promise),
        then: promise.then.bind(promise),
      };
      return query;
    }),
  });
}

function request(action: string): NextRequest {
  return new NextRequest('https://crm.example.test/api/instantly/campaigns/campaign', {
    method: 'POST',
    headers: { origin: 'https://crm.example.test', 'content-type': 'application/json' },
    body: JSON.stringify({ action }),
  });
}

const context = { params: Promise.resolve({ id: 'campaign' }) };

beforeEach(() => {
  mocks.session.mockResolvedValue({ user: { id: 'owner' }, teamAccess: { mode: 'legacy' } });
  mocks.activate.mockResolvedValue(undefined);
  mocks.pause.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  setup('ready');
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

it('activates a ready campaign only after claiming the operation', async () => {
  const response = await POST(request('activate'), context);
  expect(response.status).toBe(200);
  expect(updates).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'starting' }));
  expect(updates.mock.invocationCallOrder[0]).toBeLessThan(mocks.activate.mock.invocationCallOrder[0]);
  expect(mocks.activate).toHaveBeenCalledWith('provider-campaign');
});

it('resumes a paused campaign', async () => {
  setup('paused');
  const response = await POST(request('activate'), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ campaign: { id: 'campaign', status: 'active' } });
});

it('pauses an active campaign', async () => {
  setup('active');
  const response = await POST(request('pause'), context);
  expect(response.status).toBe(200);
  expect(mocks.pause).toHaveBeenCalledWith('provider-campaign');
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'paused' }));
});

it('does not retry a campaign with an uncertain activation', async () => {
  setup('activation_unknown');
  const response = await POST(request('activate'), context);
  expect(response.status).toBe(409);
  expect(mocks.activate).not.toHaveBeenCalled();
});

it('does not call the provider when the claim loses a race', async () => {
  results[1].data = null;
  const response = await POST(request('activate'), context);
  expect(response.status).toBe(409);
  expect(mocks.activate).not.toHaveBeenCalled();
});

it('records an uncertain provider result without retrying', async () => {
  mocks.activate.mockRejectedValue(new InstantlyApiError('Unconfirmed request.', null));
  const response = await POST(request('activate'), context);
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'activation_unknown' }));
  expect(mocks.activate).toHaveBeenCalledTimes(1);
});

it('restores paused state when the provider explicitly rejects resume', async () => {
  setup('paused');
  mocks.activate.mockRejectedValue(new InstantlyApiError('Rejected.', 400));
  const response = await POST(request('activate'), context);
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(updates).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'paused' }));
});

it('reports persistence failures even if recording uncertainty also fails', async () => {
  results[2].error = { message: 'Database unavailable.', code: '08006' };
  results.push({ data: null, error: { message: 'Still unavailable.', code: '08006' } });
  const response = await POST(request('activate'), context);
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(console.error).toHaveBeenCalledWith('[instantly/campaign-operation-state]', expect.objectContaining({ code: '08006' }));
  expect(mocks.activate).toHaveBeenCalledTimes(1);
});
