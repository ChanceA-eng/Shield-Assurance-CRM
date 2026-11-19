import { afterEach, expect, it, vi } from 'vitest';
import { saveReviewedIntakeDocuments, uploadAccountDocument } from './account-document-client';
import type { LocalIntakeDocument } from './policy-document-intake';

afterEach(() => vi.unstubAllGlobals());

it('retries confirmation of the same uploaded bytes instead of creating a second upload', async () => {
  let uploads = 0;
  class Upload {
    status = 200;
    upload = {};
    onload?: () => void;
    open(): void {}
    setRequestHeader(): void {}
    send(): void { uploads++; this.onload?.(); }
  }
  vi.stubGlobal('XMLHttpRequest', Upload);
  let confirmations = 0;
  const bodies: unknown[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).endsWith('/complete')) {
      confirmations++;
      bodies.push(JSON.parse(String(init?.body)));
      return confirmations === 1 ? Response.json({ message: 'Temporary database error' }, { status: 500 })
        : Response.json({ id: 'recorded-file', file_name: 'Coverage.pdf' });
    }
    return Response.json({ upload: { signed_url: 'https://storage.example.invalid/upload', storage_path: 'same-path', content_type: 'application/pdf' },
      file: { file_name: 'Coverage.pdf', content_type: 'application/pdf', file_size: 4 } });
  });
  vi.stubGlobal('fetch', fetcher);
  const file = new File(['test'], 'Coverage.pdf', { type: 'application/pdf' });
  expect(await uploadAccountDocument('account', file)).toEqual({ ok: false, message: 'Temporary database error' });
  expect(await uploadAccountDocument('account', file)).toMatchObject({ ok: true, document: { id: 'recorded-file' } });
  expect(uploads).toBe(1);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('preserves the reviewed schedules privately and retries metadata failure without uploading duplicate bytes', async () => {
    let uploads = 0;
    class Upload {
      status = 200; upload = {}; onload?: () => void;
      open(): void {}
      setRequestHeader(): void {}
      send(): void { uploads++; this.onload?.(); }
    }
    vi.stubGlobal('XMLHttpRequest', Upload);
    const fields = { policy_number: 'QA-123', coverage_limits: 'Each occurrence: $1,000,000',
      vehicles: '2023 Ford Transit\n2022 Toyota Camry', drivers: 'Synthetic Driver One' };
    const document: LocalIntakeDocument = { id: 'local-id', file: new File(['test'], 'Policy.pdf', { type: 'application/pdf' }),
      kind: 'policy', pages: [], suggestions: [] };
    const uploaded = new Map<string, string>();
    const patches: unknown[] = [];
    let fail = true;
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
      const body: unknown = JSON.parse(String(init?.body));
      if (init?.method === 'PATCH') {
        patches.push(body);
        return fail ? Response.json({ message: 'Temporary metadata failure' }, { status: 500 }) : Response.json({ id: 'saved-file', intake_review: fields });
      }
      if (String(input).endsWith('/complete')) {
        expect(body).toMatchObject({ intake_review: fields });
        return Response.json({ id: 'saved-file', file_name: 'Policy.pdf' });
      }
      return Response.json({ upload: { signed_url: 'https://storage.example.invalid/upload', storage_path: 'same-path', content_type: 'application/pdf' },
        file: { file_name: 'Policy.pdf', content_type: 'application/pdf', file_size: 4 } });
    }));
    await expect(saveReviewedIntakeDocuments('account', [document], fields, uploaded)).rejects.toThrow('Temporary metadata failure');
    fail = false;
    await expect(saveReviewedIntakeDocuments('account', [document], fields, uploaded)).resolves.toBe('saved-file');
    expect(uploads).toBe(1);
    expect(patches).toEqual([{ id: 'saved-file', intake_review: fields }, { id: 'saved-file', intake_review: fields }]);
  });
