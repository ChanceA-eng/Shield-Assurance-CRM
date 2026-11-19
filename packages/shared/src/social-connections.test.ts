import { describe, expect, it } from 'vitest';
import { parseSocialConnectionCommand } from './social-connections.js';

describe('social connection commands', () => {
  it('accepts only known, correctly shaped commands', () => {
    expect(parseSocialConnectionCommand({ action: 'select_page', page_id: '12345', include_instagram: true }))
      .toEqual({ action: 'select_page', page_id: '12345', include_instagram: true });
    expect(parseSocialConnectionCommand({ action: 'disconnect_account', id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d' }))
      .toEqual({ action: 'disconnect_account', id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d' });
    expect(parseSocialConnectionCommand({ action: 'revoke_grant', grant_id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d' }))
      .toEqual({ action: 'revoke_grant', grant_id: '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d' });
    expect(parseSocialConnectionCommand({ action: 'finish_selection' })).toEqual({ action: 'finish_selection' });
  });

  it.each([
    null,
    [],
    { action: 'select_page', page_id: '123', include_instagram: 1 },
    { action: 'disconnect_account', id: 'not-a-uuid' },
    { action: 'revoke_grant', grant_id: 'not-a-uuid' },
    { action: 'finish_selection', token: 'secret' },
    { action: 'select_page', page_id: '123', include_instagram: false, token: 'secret' },
  ])('rejects malformed or unexpected input %#', (input) => {
    expect(() => parseSocialConnectionCommand(input)).toThrow();
  });
});
