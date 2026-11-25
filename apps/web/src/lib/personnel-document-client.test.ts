import { beforeEach, expect, it, vi } from 'vitest';
import { putToSignedUrl } from './account-document-client';
import { finishPersonnelUpload, type PersonnelUpload } from './personnel-document-client';
import { workspaceFetch } from './workspace-fetch';

vi.mock('./account-document-client', () => ({ putToSignedUrl: vi.fn() }));
vi.mock('./workspace-fetch', () => ({ workspaceFetch: vi.fn() }));

const upload: PersonnelUpload = {
  ticket: { id: 'id', signed_url: 'https://storage.example.invalid', content_type: 'application/pdf', confirmation: 'proof' },
  member: 'member', file: new File(['pdf'], 'agreement.pdf', { type: 'application/pdf' }),
  retain: '2030-01-01', shared: false, uploaded: false,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workspaceFetch).mockResolvedValue({ ok: true });
});

it('confirms an upload when the storage response is lost', async () => {
  vi.mocked(putToSignedUrl).mockResolvedValue({ ok: false, message: 'Connection interrupted.' });
  const markUploaded = vi.fn();
  await expect(finishPersonnelUpload(upload, markUploaded)).resolves.toBeUndefined();
  expect(markUploaded).not.toHaveBeenCalled();
  expect(workspaceFetch).toHaveBeenCalledOnce();
});

it('reports both failures when storage did not accept the file', async () => {
  vi.mocked(putToSignedUrl).mockResolvedValue({ ok: false, message: 'Connection interrupted.' });
  vi.mocked(workspaceFetch).mockRejectedValue(new Error('File not found.'));
  await expect(finishPersonnelUpload(upload, vi.fn())).rejects.toThrow('Connection interrupted. File not found.');
});

it('does not re-upload when only confirmation needs retrying', async () => {
  await finishPersonnelUpload({ ...upload, uploaded: true }, vi.fn());
  expect(putToSignedUrl).not.toHaveBeenCalled();
  expect(workspaceFetch).toHaveBeenCalledOnce();
});

it('preserves the uploaded state when confirmation fails after a successful upload', async () => {
  vi.mocked(putToSignedUrl).mockResolvedValue({ ok: true });
  vi.mocked(workspaceFetch).mockRejectedValue(new Error('Confirmation unavailable.'));
  const markUploaded = vi.fn();
  await expect(finishPersonnelUpload(upload, markUploaded)).rejects.toThrow('Confirmation unavailable.');
  expect(markUploaded).toHaveBeenCalledOnce();
});
