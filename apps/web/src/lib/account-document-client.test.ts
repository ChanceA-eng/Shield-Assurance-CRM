import { afterEach, expect, it, vi } from 'vitest';
import { uploadAccountDocument } from './account-document-client';

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
