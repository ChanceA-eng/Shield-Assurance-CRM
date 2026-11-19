import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const query = vi.fn();
  const execute = vi.fn();
  const document = { create: vi.fn(), deleteMany: vi.fn() };
  const insight = { create: vi.fn() };
  const transaction = vi.fn(async (work: (tx: object) => Promise<unknown>) => work({
    $queryRaw: query, $executeRaw: execute, knowledgeDocument: document, documentInsight: insight,
  }));
  return { query, execute, document, insight, transaction };
});
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction, $queryRaw: mocks.query } }));
import { assertRegularRashiSource, publishReviewedPolicyWording, withdrawReviewedPolicyWording } from './rashi-server';

const actor = '65472c9e-dbf5-4e22-ac93-6328285eff91';
const id = '0b961bce-ad74-4822-a176-7d416d93489b';
const candidate = {
  id, revision: 3, approved_revision: 3, state: 'approved', carrier: 'Example Carrier',
  form_number: 'CG 00 01', edition: '04 13', jurisdiction: 'Arizona', line_of_business: 'General liability',
  wording: 'This insurance does not apply to bodily injury expected or intended from the standpoint of the insured.',
  account_id: 'never-forward-private-account-id', created_by: actor,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OPENAI_API_KEY', 'synthetic-test-key');
  mocks.document.create.mockResolvedValue({ id });
  mocks.insight.create.mockResolvedValue({ id: 'insight' });
  mocks.execute.mockResolvedValue(1);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function approved(): void {
  mocks.query.mockResolvedValueOnce([{ user_id: actor }]).mockResolvedValueOnce([candidate]);
}
describe('approved policy wording publication', () => {
  it('prevents ordinary source attachment or re-ingestion from bypassing the review boundary', async () => {
    mocks.query.mockResolvedValueOnce([{ id }]);
    await expect(assertRegularRashiSource(id)).rejects.toThrow('Private originals cannot be attached');
    mocks.query.mockResolvedValueOnce([]);
    await expect(assertRegularRashiSource('ordinary-source')).resolves.toBeUndefined();
  });
  it('does not contact an external service or write knowledge for an agent', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    mocks.query.mockResolvedValueOnce([]);
    await expect(publishReviewedPolicyWording(actor, id, 3)).rejects.toThrow('active owner');
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.document.create).not.toHaveBeenCalled();
  });
  it.each([
    { state: 'submitted', approved_revision: null },
    { state: 'approved', approved_revision: 2 },
    { state: 'withdrawn', approved_revision: null },
  ])('does not embed an unapproved or stale revision: %s', async (changes) => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    mocks.query.mockResolvedValueOnce([{ user_id: actor }]).mockResolvedValueOnce([{ ...candidate, ...changes }]);
    await expect(publishReviewedPolicyWording(actor, id, 3)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.document.create).not.toHaveBeenCalled();
  });
  it('publishes only approved scoped wording, never a private source URL or account identifier', async () => {
    approved();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    vi.stubGlobal('fetch', fetcher);
    await expect(publishReviewedPolicyWording(actor, id, 3)).resolves.toBe(id);
    const sent = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(sent).toContain(candidate.wording);
    expect(sent).toContain('not carrier-wide underwriting appetite');
    expect(sent).not.toContain(candidate.account_id);
    expect(mocks.document.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id, sourceUrl: null, status: 'READY', stateContext: 'ARIZONA', policyType: 'GENERAL LIABILITY',
    }) });
    expect(mocks.insight.create).toHaveBeenCalledWith({ data: expect.objectContaining({ documentId: id, insightIndex: 0 }) });
    expect(mocks.execute).toHaveBeenCalledTimes(3);
  });
  it('retains approval without success-shaped fallback when the embedding provider fails', async () => {
    approved(); vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(publishReviewedPolicyWording(actor, id, 3)).rejects.toThrow('nothing was indexed');
    expect(mocks.document.create).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('fails explicitly when the embedding provider is unconfigured', async () => {
    approved(); vi.stubEnv('OPENAI_API_KEY', '');
    await expect(publishReviewedPolicyWording(actor, id, 3)).rejects.toThrow('Configure OPENAI_API_KEY');
    expect(mocks.document.create).not.toHaveBeenCalled();
  });
  it('retries an already published exact revision without another embedding or duplicate document', async () => {
    mocks.query.mockResolvedValueOnce([{ user_id: actor }]).mockResolvedValueOnce([{ ...candidate, state: 'published' }]);
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(publishReviewedPolicyWording(actor, id, 3)).resolves.toBe(id);
    expect(fetcher).not.toHaveBeenCalled(); expect(mocks.document.create).not.toHaveBeenCalled();
  });
  it('withdraws the indexed document in the same transaction as the candidate and audit change', async () => {
    approved();
    await withdrawReviewedPolicyWording(actor, id, 3);
    expect(mocks.document.deleteMany).toHaveBeenCalledWith({ where: { id } });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });
  it('does not withdraw a stale revision', async () => {
    mocks.query.mockResolvedValueOnce([{ user_id: actor }]).mockResolvedValueOnce([{ revision: 4 }]);
    await expect(withdrawReviewedPolicyWording(actor, id, 3)).rejects.toThrow('Candidate changed');
    expect(mocks.document.deleteMany).not.toHaveBeenCalled();
  });
});
