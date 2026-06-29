export type SignatureStyle = 'personal' | 'system';

const PERSONAL_SIGNATURE = `--
Chance Amani
Founder & Principal Agent
www.shield-assurance.com
P: (520) 261-1618
A: 1718 E Speedway Blvd, Tucson, AZ 85719 (Mailing only)`;

const SYSTEM_SIGNATURE = `--
Shield Assurance Automation Team
www.shield-assurance.com
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

  if (normalizedBody.includes(normalizedSignature)) {
    return normalizedBody;
  }

  const otherSignature = normalizeBody(resolveSignature(style === 'personal' ? 'system' : 'personal'));
  if (normalizedBody.includes(otherSignature)) {
    return normalizedBody;
  }

  return `${normalizedBody}\n\n${normalizedSignature}`;
}

export { PERSONAL_SIGNATURE, SYSTEM_SIGNATURE };
