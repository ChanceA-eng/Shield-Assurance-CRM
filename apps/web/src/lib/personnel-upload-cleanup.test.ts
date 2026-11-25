import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { cleanExpiredPersonnelUploads } from './personnel-upload-cleanup';

const member = '10000000-0000-4000-8000-000000000001';
const id = '10000000-0000-4000-8000-000000000002';
const path = `${member}/${id}/document`;

it('removes only claimed expired objects before finalizing their reservations', async () => {
  const calls: string[] = [];
  const db = createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname.endsWith('/claim_expired_personnel_uploads')) return Response.json([{ id, storage_path: path }]);
      if (url.pathname.endsWith('/personnel-documents')) {
        expect(JSON.parse(String(init?.body))).toEqual({ prefixes: [path] });
        return Response.json([]);
      }
      if (url.pathname.endsWith('/finish_expired_personnel_upload')) {
        expect(JSON.parse(String(init?.body))).toEqual({ p_id: id });
        return Response.json(null);
      }
      throw new Error('Unexpected request.');
    } },
  });
  expect(await cleanExpiredPersonnelUploads(db)).toEqual({ removed: 1 });
  expect(calls).toEqual(['/rest/v1/rpc/claim_expired_personnel_uploads', '/storage/v1/object/personnel-documents',
    '/rest/v1/rpc/finish_expired_personnel_upload']);
});

it('does not remove an unexpected object reference', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json([{ id, storage_path: `${member}/other/document` }]));
  const db = createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: fetcher },
  });
  await expect(cleanExpiredPersonnelUploads(db)).rejects.toThrow('invalid reference');
  expect(fetcher).toHaveBeenCalledOnce();
});

it('does not finalize a reservation if storage removal fails', async () => {
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/claim_expired_personnel_uploads')) return Response.json([{ id, storage_path: path }]);
    return Response.json({ message: 'Unavailable' }, { status: 503 });
  });
  const db = createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: fetcher },
  });
  await expect(cleanExpiredPersonnelUploads(db)).rejects.toThrow('Retry cleanup');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('continues cleaning other reservations when one storage removal fails', async () => {
  const secondId = '10000000-0000-4000-8000-000000000003';
  const secondPath = `${member}/${secondId}/document`;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname.endsWith('/claim_expired_personnel_uploads')) {
      return Response.json([{ id, storage_path: path }, { id: secondId, storage_path: secondPath }]);
    }
    if (url.pathname.endsWith('/personnel-documents')) {
      const body = JSON.parse(String(init?.body)) as { prefixes: string[] };
      return body.prefixes[0] === path ? Response.json({ message: 'Unavailable' }, { status: 503 }) : Response.json([]);
    }
    expect(JSON.parse(String(init?.body))).toEqual({ p_id: secondId });
    return Response.json(null);
  });
  const db = createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false }, global: { fetch: fetcher },
  });
  await expect(cleanExpiredPersonnelUploads(db)).rejects.toThrow('1 expired personnel upload(s)');
  expect(fetcher).toHaveBeenCalledTimes(4);
});
