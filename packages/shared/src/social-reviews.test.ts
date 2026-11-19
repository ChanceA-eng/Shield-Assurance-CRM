import { describe, expect, it } from 'vitest';
import { validateSocialReviewCommand } from './social-reviews.js';
const command = { id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d', action: 'submit', expected_revision: 1, expected_review_version: 0 };
describe('Social review commands', () => {
  it('accepts submission and trims reviewer notes', () => {
    expect(validateSocialReviewCommand(command).command).toEqual({ ...command, reason: '' });
    expect(validateSocialReviewCommand({ ...command, action: 'request_changes', reason: ' Change caption ' }).command?.reason).toBe('Change caption');
  });
  it.each([null, [], {}, { ...command, actor: 'spoofed' }, { ...command, action: 'publish' }, { ...command, expected_revision: 0 },
    { ...command, expected_review_version: -1 }, { ...command, expected_review_version: 2147483647 }, { ...command, expected_review_version: '0' },
    { ...command, action: 'request_changes', reason: '' }, { ...command, reason: 'not accepted' },
    { ...command, action: 'approve', reason: 'x'.repeat(1001) }, { ...command, action: 'approve', reason: '\u0000' }])
    ('rejects invalid review %j', (value) => { expect(validateSocialReviewCommand(value).error).toBeTruthy(); });
});
