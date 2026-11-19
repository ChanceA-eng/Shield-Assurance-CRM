import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFor(version: string): Buffer {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version)) throw new Error('Social token key version is invalid.');
  let keyring: unknown;
  try { keyring = JSON.parse(process.env.SOCIAL_TOKEN_KEYS ?? '{}'); }
  catch { throw new Error('Social token keyring JSON is invalid.'); }
  if (!keyring || typeof keyring !== 'object' || Array.isArray(keyring)
    || typeof (keyring as Record<string, unknown>)[version] !== 'string') {
    throw new Error('Social token encryption is not configured.');
  }
  const encoded = (keyring as Record<string, string>)[version];
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) throw new Error('Social token encryption keys must contain 32 bytes in canonical base64.');
  return key;
}

export function validateSocialTokenConfiguration(): void {
  keyFor(process.env.SOCIAL_TOKEN_KEY_VERSION ?? '');
}

export function sealSocialToken(value: string, context: string): string {
  const version = process.env.SOCIAL_TOKEN_KEY_VERSION ?? '';
  if (!value || value.length > 20000 || !context || context.length > 500) throw new Error('Social token input is invalid.');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(version), nonce);
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [version, nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function openSocialToken(envelope: string, context: string): string {
  const [version, nonceText, tagText, ciphertextText, extra] = envelope.split('.');
  if (!version || !nonceText || !tagText || !ciphertextText || extra || !context || context.length > 500) {
    throw new Error('Stored social authorization is invalid. Reconnect the account.');
  }
  const nonce = Buffer.from(nonceText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  const ciphertext = Buffer.from(ciphertextText, 'base64url');
  if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length > 20000
    || nonce.toString('base64url') !== nonceText || tag.toString('base64url') !== tagText
    || ciphertext.toString('base64url') !== ciphertextText) {
    throw new Error('Stored social authorization is invalid. Reconnect the account.');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFor(version), nonce);
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(tag);
  try { return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'); }
  catch { throw new Error('Social authorization cannot be decrypted. Reconnect the account.'); }
}
