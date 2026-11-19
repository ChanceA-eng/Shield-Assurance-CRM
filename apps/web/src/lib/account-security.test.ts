import { afterEach, describe, expect, it, vi } from 'vitest';
import { accountOrigin, recoveryProof, validRecoveryProof, validatePassword } from './account-security';
import { appendPersonalSignature, PERSONAL_SIGNATURE } from './agency-signature';

afterEach(() => vi.unstubAllEnvs());
describe('account security validation', () => {
  it('requires at least 12 characters within the provider 72-byte limit', () => {
    for (const password of ['', 'a'.repeat(11), 'a'.repeat(73), '\u00e9'.repeat(37), null]) expect(() => validatePassword(password)).toThrow();
    expect(() => validatePassword('a'.repeat(12))).not.toThrow();
    expect(() => validatePassword('a'.repeat(72))).not.toThrow();
  });
  it('binds short-lived recovery authority to the verified user and session', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'unit-test-only-not-a-real-key');
    const proof = recoveryProof('user', 'verified-session');
    expect(validRecoveryProof(proof, 'user', 'verified-session')).toBe(true);
    expect(validRecoveryProof(proof, 'other', 'verified-session')).toBe(false);
    expect(validRecoveryProof(proof, 'user', 'other-session')).toBe(false);
    expect(validRecoveryProof(`${proof}extra`, 'user', 'verified-session')).toBe(false);
    expect(validRecoveryProof(`${proof}:extra`, 'user', 'verified-session')).toBe(false);
    expect(validRecoveryProof(recoveryProof('user', 'verified-session', Date.now() - 1), 'user', 'verified-session')).toBe(false);
    expect(validRecoveryProof(undefined, 'user', 'verified-session')).toBe(false);
  });
  it('only uses a configured HTTPS origin, never a request host', () => {
    vi.stubEnv('CRM_WEB_ORIGIN', 'https://crm.example.invalid/nested');
    expect(accountOrigin()).toBe('https://crm.example.invalid');
    for (const origin of ['', 'http://example.invalid', 'https://user:password@example.invalid']) {
      vi.stubEnv('CRM_WEB_ORIGIN', origin);
      expect(() => accountOrigin()).toThrow();
    }
  });
});
describe('personal signature delivery', () => {
  it('uses the saved signature for manual shared-mailbox sends', () => {
    expect(appendPersonalSignature('Hello', 'Jane\nAgent')).toBe('Hello\n\n-- \nJane\nAgent\nhttps://www.shield-assurance.com');
  });
  it('preserves authored signatures and does not append twice', () => {
    const body = 'Hello\n\n-- \nDraft author';
    expect(appendPersonalSignature(body, 'Jane')).toBe(`${body}\nhttps://www.shield-assurance.com`);
    const once = appendPersonalSignature('Hello', 'Jane');
    expect(appendPersonalSignature(once, 'Jane')).toBe(once);
  });
  it('retains the agency default when no personal signature is set', () => {
    expect(appendPersonalSignature('Hello', '')).toContain(PERSONAL_SIGNATURE);
  });
});
