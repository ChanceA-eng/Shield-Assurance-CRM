import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { test, expect } from './workspace-fixtures';

test('real owner review persists exact revisions and publishes/withdraws only synthetic sanitized wording', async ({ context, settingsOwner }) => {
  test.skip(process.env.CRM_POLICY_KNOWLEDGE_QA_ALLOWED !== '1', 'Requires explicitly authorized synthetic database and embedding verification.');
  test.setTimeout(120000);
  void settingsOwner;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configured private CRM database access is required.');
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL } } });
  const id = randomUUID();
  const accountId = randomUUID();
  const accountName = `Synthetic policy knowledge QA ${randomUUID()}`;
  const values = {
    id, revision: 0, account_id: accountId, carrier: 'Synthetic QA Carrier', form_number: 'QA FORM',
    edition: 'QA 2026', jurisdiction: 'Arizona', line_of_business: 'Synthetic verification',
    wording: 'This synthetic form excludes losses arising solely from intentional falsification of a test record. This sentence exists only for CRM verification.',
    privacy_confirmed: true, rights_confirmed: true,
  };
  const review = async (action: string, revision: number) => context.request.patch('/api/policy-knowledge', {
    data: { id, revision, action, privacy_confirmed: true, rights_confirmed: true },
  });
  try {
    const account = await db.from('clients').insert({ id: accountId, full_name: accountName, source: 'Synthetic policy knowledge verification' });
    if (account.error) throw new Error(account.error.message);
    const submitted = await context.request.post('/api/policy-knowledge', { data: values });
    expect(submitted.status(), await submitted.text()).toBe(200);
    expect(await submitted.json()).toMatchObject({ revision: 1, state: 'submitted' });
    expect(await prisma.knowledgeDocument.findUnique({ where: { id } })).toBeNull();
    const approved = await review('approve', 1);
    expect(approved.status(), await approved.text()).toBe(200);
    expect(await prisma.knowledgeDocument.findUnique({ where: { id } })).toBeNull();
    const edited = await context.request.post('/api/policy-knowledge', { data: {
      ...values, revision: 1, wording: `${values.wording} The synthetic exclusion applies to test records only.`,
    } });
    expect(edited.status(), await edited.text()).toBe(200);
    expect(await edited.json()).toMatchObject({ revision: 2, state: 'submitted', approved_revision: null });
    expect((await review('publish', 1)).status()).toBe(409);
    const reapproved = await review('approve', 2);
    expect(reapproved.status(), await reapproved.text()).toBe(200);
    const published = await review('publish', 2);
    expect(published.status(), await published.text()).toBe(200);
    const retry = await review('publish', 2);
    expect(retry.status(), await retry.text()).toBe(200);
    const document = await prisma.knowledgeDocument.findUnique({ where: { id }, include: { insights: true } });
    expect(document?.status).toBe('READY');
    expect(document?.sourceUrl).toBeNull();
    expect(document?.rawText).toContain('not carrier-wide underwriting appetite');
    expect(document?.rawText).not.toContain(accountId);
    expect(document?.rawText).not.toContain(accountName);
    expect(document?.insights).toHaveLength(1);
    expect(document?.insights[0]?.embeddingValues).toHaveLength(1536);
    const query = {
      documentId: id, carrierName: values.carrier, stateContext: values.jurisdiction,
      policyType: values.line_of_business, question: 'What does this synthetic form say about intentional falsification of test records?',
    };
    const answer = await context.request.post('/api/rashi/query', { data: query });
    expect(answer.status(), await answer.text()).toBe(200);
    const retrieved = await answer.json() as { citations: Array<{ documentId: string; sourceUrl: string | null }> };
    expect(retrieved.citations).toHaveLength(1);
    expect(retrieved.citations[0]).toMatchObject({ documentId: id, sourceUrl: null });
    const withdrawn = await review('withdraw', 2);
    expect(withdrawn.status(), await withdrawn.text()).toBe(200);
    expect((await review('withdraw', 2)).status()).toBe(200);
    expect(await prisma.knowledgeDocument.findUnique({ where: { id } })).toBeNull();
    expect(await prisma.documentInsight.count({ where: { documentId: id } })).toBe(0);
    const afterWithdrawal = await context.request.post('/api/rashi/query', { data: query });
    expect(afterWithdrawal.status(), await afterWithdrawal.text()).toBe(200);
    expect((await afterWithdrawal.json()).citations).toEqual([]);
    const audit = await db.from('policy_knowledge_review_events').select('action').eq('candidate_id', id).order('created_at');
    if (audit.error) throw new Error(audit.error.message);
    expect(audit.data.map((event) => event.action)).toEqual(['submitted', 'approved', 'submitted', 'approved', 'published', 'withdrawn']);
  } finally {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeDocument.deleteMany({ where: { id } });
        await tx.$executeRaw`delete from public.policy_knowledge_review_events where candidate_id=${id}::uuid`;
        await tx.$executeRaw`delete from public.policy_knowledge_candidates where id=${id}::uuid and account_id=${accountId}::uuid`;
        await tx.$executeRaw`delete from public.clients where id=${accountId}::uuid and full_name=${accountName}`;
      });
    } finally { await prisma.$disconnect(); }
  }
});
