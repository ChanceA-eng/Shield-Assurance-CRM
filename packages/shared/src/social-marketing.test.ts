import { describe, expect, it } from 'vitest';
import { validateSocialDraftCommand, SOCIAL_DRAFT_CAPTION_LIMIT } from './social-marketing.js';

const id = '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d';

describe('Social draft commands', () => {
  it('normalizes titles while preserving caption whitespace', () => {
    expect(validateSocialDraftCommand({ action: 'create', id, title: '  Coverage review  ', caption: 'Hello\n\nWorld ' }))
      .toEqual({ command: { action: 'create', id, title: 'Coverage review', caption: 'Hello\n\nWorld ', link_url: null }, error: null });
  });
  it('accepts and normalizes safe HTTPS links, but rejects unsafe or malformed URLs', () => {
    expect(validateSocialDraftCommand({ action: 'create', id, title: 'Link', caption: '', link_url: 'https://example.com/a' }).command)
      .toMatchObject({ link_url: 'https://example.com/a' });
    for (const link_url of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com', 'https://', 'x'.repeat(2049)]) {
      expect(validateSocialDraftCommand({ action: 'create', id, title: 'Link', caption: '', link_url }).error).toBeTruthy();
    }
  });
  it('allows incomplete captions only as drafts', () => {
    expect(validateSocialDraftCommand({ action: 'create', id, title: 'Idea', caption: '' }).error).toBeNull();
    expect(validateSocialDraftCommand({ action: 'publish', id, title: 'Idea', caption: '' }).command).toBeNull();
  });
  it.each([null, [], 'caption', {}, { action: 'create', id: 'wrong', title: 'Idea', caption: '' },
    { action: 'create', id, title: ' ', caption: '' }, { action: 'create', id, title: 'x'.repeat(161), caption: '' },
    { action: 'create', id, title: 'Idea', caption: 'x'.repeat(SOCIAL_DRAFT_CAPTION_LIMIT + 1) },
    { action: 'create', id, title: 'Idea', caption: '\u0000' },
    { action: 'create', id, title: 'Idea', caption: '', workspace_id: id },
    { action: 'update', id, title: 'Idea', caption: '' },
    { action: 'update', id, title: 'Idea', caption: '', expected_revision: '1' },
    { action: 'archive', id, expected_revision: 0 },
    { action: 'archive', id, expected_revision: 2147483647 },
    { action: 'archive', id, expected_revision: 1, caption: 'Changed' }])('rejects invalid or unauthorized command shapes: %j', (value) => {
    const result = validateSocialDraftCommand(value);
    expect(result.command).toBeNull();
    expect(result.error).toBeTruthy();
  });
  it('counts Unicode characters consistently with PostgreSQL', () => {
    expect(validateSocialDraftCommand({ action: 'create', id, title: 'Idea', caption: '😀'.repeat(10000) }).error).toBeNull();
  });
  it('requires a version for update and archive', () => {
    expect(validateSocialDraftCommand({ action: 'update', id, title: 'Idea', caption: '', expected_revision: 2 }).error).toBeNull();
    expect(validateSocialDraftCommand({ action: 'archive', id, expected_revision: 2 }).command)
      .toEqual({ action: 'archive', id, expected_revision: 2 });
  });
  it('validates optional single-image attachments and explicit removal', () => {
    const command = { action: 'update', id, title: 'Idea', caption: '', expected_revision: 1 };
    expect(validateSocialDraftCommand({ ...command, media_ids: [id] }).command).toMatchObject({ media_ids: [id] });
    expect(validateSocialDraftCommand({ ...command, media_ids: [] }).command).toMatchObject({ media_ids: [] });
    for (const media_ids of [[id, id], [null], ['wrong'], id]) {
      expect(validateSocialDraftCommand({ ...command, media_ids }).error).toBeTruthy();
    }
  });
});
