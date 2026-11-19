import { ensureWebsiteLink } from '@crm/shared';

export type SignatureStyle = 'personal' | 'system';

const PERSONAL_SIGNATURE = `--
Chance Amani
Founder & Principal Agent
https://www.shield-assurance.com
P: (520) 261-1618
A: 1718 E Speedway Blvd, Tucson, AZ 85719 (Mailing only)`;

const SYSTEM_SIGNATURE = `--
Shield Assurance Automation Team
https://www.shield-assurance.com
support@shield-assurance.com`;

function normalizeBody(value: string): string {
  return value.replace(/\r\n/g, '\n').trimEnd();
}

function resolveSignature(style: SignatureStyle): string {
  return style === 'system' ? SYSTEM_SIGNATURE : PERSONAL_SIGNATURE;
}

export function appendAgencySignature(body: string, style: SignatureStyle = 'personal'): string {
  const normalizedBody = normalizeBody(body);
  const normalizedSignature = normalizeBody(resolveSignature(style));

  if (!normalizedBody) {
    return normalizedSignature;
  }

  // AI drafts carry an explicit, authored signature; never add a second producer.
  if (style === 'personal' && /\n-- \n\S/.test(normalizedBody)) {
    return ensureWebsiteLink(normalizedBody);
  }

  if (normalizedBody.includes(normalizedSignature)) {
    return ensureWebsiteLink(normalizedBody);
  }

  const otherSignature = normalizeBody(resolveSignature(style === 'personal' ? 'system' : 'personal'));
  if (normalizedBody.includes(otherSignature)) {
    return ensureWebsiteLink(normalizedBody);
  }

  return `${normalizedBody}\n\n${normalizedSignature}`;
}

export { PERSONAL_SIGNATURE, SYSTEM_SIGNATURE };

export function appendPersonalSignature(body: string, signature: unknown): string {
  if (typeof signature !== 'string' || !signature.trim()) return appendAgencySignature(body, 'personal');
  const normalized = normalizeBody(body);
  if (/\n-- ?\n\S/.test(normalized) || normalized.includes(signature.trim())) return ensureWebsiteLink(normalized);
  return ensureWebsiteLink(`${normalized}\n\n-- \n${signature.trim()}`);
}
