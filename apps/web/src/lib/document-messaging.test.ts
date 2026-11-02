import { describe, expect, it } from 'vitest';
import { accountEmailConsent, leadEmailConsent } from './message-delivery';
import { conversationKeyForRow, isUnreadInbound } from './conversations';
import { classifyClientFile, isDocumentPathForClient, validateUploadRequest, MAX_ACCOUNT_DOCUMENT_BYTES, toClientFileView } from './account-documents';

const client = '039d0052-4587-4bb9-9f0b-d5b92407f58c';
const file = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
describe('document and communication reliability', () => {
  it('does not represent a legacy local placeholder as uploaded bytes', () => {
    expect(classifyClientFile({ file_url: 'local-upload://example.pdf', metadata: {} })).toBe('legacy_placeholder');
    const view = toClientFileView({ id: file, client_id: client, file_name: 'example.pdf', file_url: 'local-upload://example.pdf', metadata: {}, file_type: 'PDF', file_size: 100, status: 'uploaded', uploaded_at: null, created_at: null });
    expect(view).toMatchObject({ status: 'not_uploaded', file_url: null, download_url: null });
  });
  it('validates actual file size, type and account ownership', () => {
    expect(validateUploadRequest({ fileName: 'example.pdf', contentType: '', size: 12 }).ok).toBe(true);
    expect(validateUploadRequest({ fileName: 'example.exe', size: 12 }).ok).toBe(false);
    expect(validateUploadRequest({ fileName: 'example.pdf', size: 0 }).ok).toBe(false);
    expect(validateUploadRequest({ fileName: 'example.pdf', size: MAX_ACCOUNT_DOCUMENT_BYTES + 1 }).ok).toBe(false);
    expect(isDocumentPathForClient(`clients/${client}/${file}/example.pdf`, client)).toBe(true);
    expect(isDocumentPathForClient(`clients/${client}/${file}/../example.pdf`, client)).toBe(false);
    expect(isDocumentPathForClient(`clients/${file}/${file}/example.pdf`, client)).toBe(false);
  });
  it('enforces explicit opt-outs and declined intake contact', () => {
    expect(accountEmailConsent({ email: 'a@example.invalid', email_consent: true }, true).allowed).toBe(false);
    expect(accountEmailConsent({ email: 'a@example.invalid', email_consent: false, preferred_channel: 'sms' }, false).allowed).toBe(false);
    expect(leadEmailConsent({ email: 'a@example.invalid', form_payload: { metadata: { contactConsent: { accepted: false } } } }, false).allowed).toBe(false);
  });
  it('keeps canonical account conversations and does not conflate unread state with reply state', () => {
    expect(conversationKeyForRow({ id: file, client_id: null, direction: 'inbound', metadata: { lead_id: file } }, new Map([[file, client]]))).toBe(`client:${client}`);
    expect(isUnreadInbound({ direction: 'inbound', read_at: '2026-11-02T12:00:00Z' })).toBe(false);
    expect(conversationKeyForRow({ id: file, client_id: null, direction: 'inbound', metadata: { from: 'Person <A@EXAMPLE.INVALID>' } })).toBe('unmatched:a@example.invalid');
  });
});
