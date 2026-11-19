import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from '../app/api/outreach/outbox/[id]/rewrite/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { rewriteOutreach } from './outreach-ai';
import { leadOutreachContext } from './lead-outreach-context';
import { WorkspaceError } from './record-scope';
import { DEFAULT_OUTREACH_SENDER, EMPTY_MARKETING_PROFILE } from '@crm/shared';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./outreach-ai', () => ({ rewriteOutreach: vi.fn() }));
vi.mock('./lead-outreach-context', () => ({ leadOutreachContext: vi.fn() }));
vi.mock('./agency-membership', () => ({ agencyEnabled: () => false }));
const id = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const draft = { subject: 'Revised subject', body: 'Revised body', cited_signals: ['Commercial auto'] };
const input = { instruction: 'Make it warmer', subject: 'My edited subject', body: 'My edited body', revision: 0 };
let item: Record<string, unknown>;
let writes: Array<Record<string, unknown>>;
let saveError: { code: string; message: string } | null;
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const post = (body: unknown = input): Promise<Response> => POST(new NextRequest(`http://localhost/api/outreach/outbox/${id}/rewrite`,
  { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  item = { id, lead_id: id, status: 'pending_approval', draft_revision: 0, step_number: 2, agent_user_id: null };
  writes = []; saveError = null;
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: actor }, error: null } as Awaited<ReturnType<typeof getApiSession>>);
  vi.mocked(rewriteOutreach).mockResolvedValue(draft);
  vi.mocked(leadOutreachContext).mockResolvedValue({
    workspace_assets: [], workspace_notes: [], recent_conversation: [], marketing_profile: EMPTY_MARKETING_PROFILE,
    outreach_sender: { ...DEFAULT_OUTREACH_SENDER, name: 'Taylor', signature: 'Taylor' },
  });
  const fetcher: typeof fetch = async (url, init) => {
    const path = String(url);
    if (path.includes('/rpc/rewrite_outreach_draft')) {
      writes.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return saveError ? json(saveError, 409) : json(1);
    }
    if (path.includes('/outreach_outbox')) return json(item);
    if (path.includes('/leads')) return json({ id, full_name: 'Leo' });
    throw new Error(`Unexpected request: ${path}`);
  };
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
    global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
  }));
});

describe('outbox rewrite route', () => {
  it('uses edited text, specific instructions and actor-scoped context, persisting only a reviewed draft', async () => {
    const response = await post();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...draft, draft_revision: 1 });
    expect(leadOutreachContext).toHaveBeenCalledWith(expect.anything(), id, actor);
    expect(rewriteOutreach).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Leo', outreach_sender: expect.objectContaining({ name: 'Taylor' }) }),
      { subject: input.subject, body: input.body }, input.instruction, 2);
    expect(writes).toEqual([{ p_outbox_id: id, p_actor_id: actor, p_revision: 0,
      p_subject: draft.subject, p_body: draft.body, p_signals: draft.cited_signals }]);
  });
  it.each(['', 'x'.repeat(1001), 123])('rejects invalid rewrite instructions before generation', async (instruction) => {
    expect((await post({ ...input, instruction })).status).toBe(400);
    expect(rewriteOutreach).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
  it.each(['sending', 'sent', 'acceptance_unknown', 'accepted_by_provider', 'rejected'])('cannot rewrite a %s item', async (status) => {
    item.status = status;
    expect((await post()).status).toBe(409);
    expect(rewriteOutreach).not.toHaveBeenCalled();
  });
  it('rejects non-owners even when multi-agent mode is disabled', async () => {
    item.agent_user_id = id;
    expect((await post()).status).toBe(403);
    expect(rewriteOutreach).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    vi.mocked(getApiSession).mockResolvedValue({ error: NextResponse.json({ message: 'Unauthorized' }, { status: 401 }) } as Awaited<ReturnType<typeof getApiSession>>);
    expect((await post()).status).toBe(401);
    expect(rewriteOutreach).not.toHaveBeenCalled();
  });
  it('rejects stale input before calling AI', async () => {
    item.draft_revision = 1;
    expect((await post()).status).toBe(409);
    expect(rewriteOutreach).not.toHaveBeenCalled();
  });
  it('reports a concurrent change after generation without overwriting it', async () => {
    saveError = { code: 'PT409', message: 'This draft changed.' };
    expect((await post()).status).toBe(409);
  });
  it('does not save substitute content when the provider is unavailable', async () => {
    vi.mocked(rewriteOutreach).mockResolvedValue(null);
    expect((await post()).status).toBe(503);
    expect(writes).toEqual([]);
  });
  it('preserves the original when quality checks fail', async () => {
    vi.mocked(rewriteOutreach).mockRejectedValue(new WorkspaceError('Quality check failed.', 422));
    expect((await post()).status).toBe(422);
    expect(writes).toEqual([]);
  });
});
