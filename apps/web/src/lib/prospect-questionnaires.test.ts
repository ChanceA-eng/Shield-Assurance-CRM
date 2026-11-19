import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { parseProspectAnswers, parseProspectContact, parseQuestionnaire, prospectUpload } from './prospect-questionnaires';

const require = createRequire(import.meta.url);
const scanner: { matchesFile: (bytes: Buffer, type: string) => boolean; signatureVersion: (text: string, now?: number) => string } =
  require('../../scripts/scan-prospect-documents.cjs');
const cleanup: { runCleanup: (db: SupabaseClient) => Promise<void> } = require('../../scripts/cleanup-prospect-documents.cjs');
const question = { id: '108a5200-9382-4c96-a6e8-a3c09d6f0e40', label: 'Name', type: 'text', required: true, options: [], field: 'full_name' };
const design = () => parseQuestionnaire({ name: 'My request', questions: [question] });
it('requires first and last names before verification without treating names as identity proof', () => {
  expect(parseProspectContact({ first_name: ' Synthetic ', last_name: ' Prospect ' })).toEqual({ first_name: 'Synthetic', last_name: 'Prospect' });
  for (const contact of [{ first_name: '', last_name: 'Prospect' }, { first_name: 'Synthetic', last_name: '' },
    { first_name: 'Synthetic\nInjected', last_name: 'Prospect' }]) expect(() => parseProspectContact(contact)).toThrow(/first and last name/);
});
it('records deletion only after private storage confirms it and leaves failed deletions retryable', async () => {
  const calls: string[] = [];
  let claimed = false, rejectStorage = false;
  const db = createClient('https://example.supabase.co', 'synthetic-key', { auth: { persistSession: false },
    global: { fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { p_action?: string };
      if (String(url).includes('/storage/')) {
        calls.push('remove');
        return Response.json(rejectStorage ? { message: 'Synthetic storage unavailable' } : [], { status: rejectStorage ? 500 : 200 });
      }
      calls.push(body.p_action ?? '');
      if (body.p_action === 'finish') return Response.json({ deleted: true });
      if (claimed) return Response.json(null);
      claimed = true;
      return Response.json({ id: question.id, storage_path: 'synthetic/private', lease: question.id });
    } },
  });
  await cleanup.runCleanup(db);
  expect(calls).toEqual(['claim', 'remove', 'finish', 'claim']);
  calls.length = 0; claimed = false; rejectStorage = true;
  await expect(cleanup.runCleanup(db)).rejects.toThrow(/no deletion receipt/);
  expect(calls).toEqual(['claim', 'remove']);
});
it('retains stable IDs and rejects duplicate mappings or questions', () => {
  expect(design().questions[0]).toEqual(question);
  expect(() => parseQuestionnaire({ name: 'Request', questions: [question, question] })).toThrow(/question/i);
  expect(() => parseQuestionnaire({ name: 'Request', questions: [question, { ...question, id: '208a5200-9382-4c96-a6e8-a3c09d6f0e40' }] })).toThrow(/map/i);
  expect(() => parseQuestionnaire({ name: 'Request', questions: [{ ...question, type: 'file' }] })).toThrow(/map/i);
});
it('rejects unknown answer keys, missing required values and invalid dates or choices', () => {
  expect(parseProspectAnswers(design(), { [question.id]: '  Synthetic prospect  ' })).toEqual({ [question.id]: 'Synthetic prospect' });
  expect(() => parseProspectAnswers(design(), { unknown: 'Injected' })).toThrow(/only/i);
  expect(() => parseProspectAnswers(design(), {})).toThrow(/complete/i);
  const dated = parseQuestionnaire({ name: 'Request', questions: [{ ...question, type: 'date', field: '' }] });
  expect(() => parseProspectAnswers(dated, { [question.id]: '2027-02-29' })).toThrow(/check/i);
  const choices = parseQuestionnaire({ name: 'Request', questions: [{ ...question, type: 'multiple', options: ['Auto', 'Home'], field: '' }] });
  expect(() => parseProspectAnswers(choices, { [question.id]: ['Auto', 'Auto'] })).toThrow(/valid/i);
  expect(parseProspectAnswers(choices, { [question.id]: ['Home'] })).toEqual({ [question.id]: ['Home'] });
});
it('bounds public uploads independently of browser MIME types', () => {
  expect(prospectUpload({ name: 'id.heic', size: 10 * 1024 * 1024 })).toEqual({ name: 'id.heic', size: 10 * 1024 * 1024, type: 'image/heic' });
  for (const upload of [{ name: '../id.pdf', size: 1 }, { name: 'id.exe', size: 1 }, { name: 'id.pdf', size: 0 },
    { name: 'id.pdf', size: 10 * 1024 * 1024 + 1 }]) expect(() => prospectUpload(upload)).toThrow(/10 MB/i);
});
it('scanner refuses spoofed file signatures and stale signature databases', () => {
  expect(scanner.matchesFile(Buffer.from('%PDF-1.7\nsynthetic'), 'application/pdf')).toBe(true);
  expect(scanner.matchesFile(Buffer.from('<html>not an image</html>'), 'image/jpeg')).toBe(false);
  expect(scanner.matchesFile(Buffer.from('89504e470d0a1a0a', 'hex'), 'image/png')).toBe(true);
  const now = Date.parse('2026-11-14T12:00:00Z');
  expect(scanner.signatureVersion('ClamAV 1.4.3/12345/Fri Nov 13 12:00:00 2026', now)).toContain('12345');
  expect(() => scanner.signatureVersion('ClamAV 1.4.3/12345/Fri Nov 06 12:00:00 2026', now)).toThrow(/48 hours/);
});
