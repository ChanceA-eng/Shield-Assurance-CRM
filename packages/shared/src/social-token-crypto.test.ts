import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSocialToken, sealSocialToken, validateSocialTokenConfiguration } from './social-token-crypto.js';

const context = 'workspace:meta:oauth:session';
afterEach(() => vi.unstubAllEnvs());
describe('encrypted social provider credentials', () => {
  it('uses randomized AES-GCM envelopes bound to workspace/account context', () => {
    vi.stubEnv('SOCIAL_TOKEN_KEY_VERSION', 'v1');
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }));
    const first = sealSocialToken('provider-secret', context);
    expect(first).not.toContain('provider-secret');
    expect(first).not.toBe(sealSocialToken('provider-secret', context));
    expect(openSocialToken(first, context)).toBe('provider-secret');
    expect(() => openSocialToken(first, 'other-workspace')).toThrow('cannot be decrypted');
    const pieces = first.split('.'); pieces[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openSocialToken(pieces.join('.'), context)).toThrow('cannot be decrypted');
  });
  it('reads historical key versions and encrypts with the configured active version', () => {
    vi.stubEnv('SOCIAL_TOKEN_KEY_VERSION', 'old');
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ old: Buffer.alloc(32, 8).toString('base64') }));
    const prior = sealSocialToken('renewable-token', context);
    vi.stubEnv('SOCIAL_TOKEN_KEY_VERSION', 'current');
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({
      old: Buffer.alloc(32, 8).toString('base64'), current: Buffer.alloc(32, 9).toString('base64'),
    }));
    expect(openSocialToken(prior, context)).toBe('renewable-token');
    expect(sealSocialToken('new-token', context)).toMatch(/^current\./);
  });
  it('rejects invalid key configuration and malformed ciphertext without leaking values', () => {
    vi.stubEnv('SOCIAL_TOKEN_KEY_VERSION', 'v1');
    vi.stubEnv('SOCIAL_TOKEN_KEYS', '{bad json');
    expect(() => sealSocialToken('private', context)).toThrow('keyring JSON is invalid');
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ v1: 'short' }));
    expect(() => sealSocialToken('private', context)).toThrow('32 bytes');
    vi.stubEnv('SOCIAL_TOKEN_KEYS', JSON.stringify({ v1: `${Buffer.alloc(32, 7).toString('base64')}ignored` }));
    expect(() => validateSocialTokenConfiguration()).toThrow('canonical base64');
    expect(() => openSocialToken('v1.bad.bad.bad', context)).toThrow('invalid');
  });
});
