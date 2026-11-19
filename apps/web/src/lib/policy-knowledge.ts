import { isRecord, isUuid } from './workspace-validation';
import { WorkspaceError } from './record-scope';

export interface PolicyKnowledgeValues {
  account_id: string;
  carrier: string;
  form_number: string;
  edition: string;
  jurisdiction: string;
  line_of_business: string;
  wording: string;
  privacy_confirmed: true;
  rights_confirmed: true;
}
export interface PolicyKnowledgeCandidate extends Omit<PolicyKnowledgeValues, 'privacy_confirmed' | 'rights_confirmed'> {
  id: string;
  revision: number;
  state: 'submitted' | 'approved' | 'rejected' | 'published' | 'withdrawn';
  approved_revision: number | null;
  created_by: string;
}

export function parsePolicyKnowledge(value: unknown): PolicyKnowledgeValues {
  if (!isRecord(value) || !isUuid(value.account_id)
    || value.privacy_confirmed !== true || value.rights_confirmed !== true) {
    throw new WorkspaceError('Select an account and confirm de-identification and reuse permission.', 400);
  }
  const result: PolicyKnowledgeValues = {
    account_id: value.account_id, carrier: '', form_number: '', edition: '', jurisdiction: '',
    line_of_business: '', wording: '', privacy_confirmed: true, rights_confirmed: true,
  };
  for (const key of ['carrier', 'form_number', 'edition', 'jurisdiction', 'line_of_business', 'wording'] as const) {
    const text = value[key];
    const max = key === 'wording' ? 6000 : key === 'carrier' ? 150 : 100;
    if (typeof text !== 'string' || text.trim().length < (key === 'wording' ? 40 : 1) || text.length > max) {
      throw new WorkspaceError(`Enter valid ${key.replace(/_/g, ' ')} (${max} characters maximum).`, 400);
    }
    result[key] = text.trim();
  }
  return result;
}

export function assertDeidentifiedPolicyKnowledge(values: PolicyKnowledgeValues, privateIdentifiers: string[]): void {
  const text = [values.carrier, values.form_number, values.edition, values.jurisdiction, values.line_of_business, values.wording].join('\n');
  const identifiers = [
    /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/,
    /\b\d{3}[- ]\d{2}[- ]\d{4}\b/,
    /(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\b\d{3})[-.\s]\d{3}[-.\s]\d{4}\b/,
    /\b[A-HJ-NPR-Z0-9]{17}\b/i,
    /\b(?:named insured|policyholder|insured address|mailing address|date of birth|social security|bank account|credit card|policy number|premium)\s*[:#]/i,
    /\b\d{1,6}\s+[A-Za-z0-9 .'-]+\s(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd)\b/i,
  ];
  const compact = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normalized = compact(text);
  if (identifiers.some((pattern) => pattern.test(text))
    || privateIdentifiers.some((identifier) => {
      const token = compact(identifier);
      return token.length >= 4 && normalized.includes(token);
    })) {
    throw new WorkspaceError('Possible customer-identifying or account-specific information remains. Remove it before submitting or approving. Nothing was sent to Rashi.', 422);
  }
}
