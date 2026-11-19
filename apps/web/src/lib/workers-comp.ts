import { validEvidenceDate, type BusinessField, type OpportunityProfile } from '@crm/shared';
import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';
import type { IntakePage } from './policy-document-intake';

export const WC_OFFICIAL_URL = 'https://www.azica.gov/obtaining-workers-compensation-coverage-information';
export const WC_KINDS = { policy: 'Policy / declarations', mod: 'Experience mod worksheet', payroll: 'Payroll summary / audit',
  loss_run: 'Carrier / TPA loss run', self_insured: 'Employer self-insurance document' } as const;
export const WC_FIELDS = {
  carrier: ['Carrier', 'text'], policy_from: ['Policy starts', 'date'], policy_to: ['Policy ends', 'date'],
  experience_mod: ['Experience mod', 'number'], mod_from: ['Mod effective date', 'date'], mod_to: ['Mod end date', 'date'],
  class_codes: ['Class codes (comma-separated)', 'text'], class_state: ['Class code state', 'text'],
  payroll: ['Payroll total', 'number'], payroll_basis: ['Payroll basis', 'text'],
  payroll_from: ['Payroll period starts', 'date'], payroll_to: ['Payroll period ends', 'date'],
  loss_from: ['Loss period starts', 'date'], loss_to: ['Loss period ends', 'date'],
  claim_count: ['Total claims', 'number'], open_claims: ['Open claims', 'number'],
  paid_losses: ['Paid losses', 'number'], incurred_losses: ['Incurred losses', 'number'],
  loss_completeness: ['Loss history provided', 'text'],
} as const;
export type WcField = keyof typeof WC_FIELDS;
export interface WcEvidence {
  kind: keyof typeof WC_KINDS;
  source_name: string;
  source_date: string;
  employer_name: string;
  employer_address: string;
  identity: 'confirmed' | 'possible';
  fields: Partial<Record<WcField, string>>;
  pages: Partial<Record<WcField, number>>;
}
export interface WcEntry { id: string; revision: number; evidence: WcEvidence; updated_at: string }
export interface WcWorkspace { entries: WcEntry[]; record_name: string; record_address: string }

const GROUPS: Record<keyof typeof WC_KINDS, readonly WcField[]> = {
  policy: ['carrier', 'policy_from', 'policy_to', 'class_codes', 'class_state'],
  mod: ['experience_mod', 'mod_from', 'mod_to', 'class_codes', 'class_state'],
  payroll: ['payroll', 'payroll_basis', 'payroll_from', 'payroll_to', 'class_codes', 'class_state'],
  loss_run: ['loss_from', 'loss_to', 'claim_count', 'open_claims', 'paid_losses', 'incurred_losses', 'loss_completeness'],
  self_insured: ['policy_from', 'policy_to'],
};
export const wcFieldsFor = (kind: WcEvidence['kind']): readonly WcField[] => GROUPS[kind];
export function parseWcEvidence(value: unknown, today = new Date().toISOString().slice(0, 10)): WcEvidence {
  const invalid = (message: string): never => { throw new WorkspaceError(message, 400); };
  if (!isRecord(value) || !Object.hasOwn(WC_KINDS, String(value.kind)) || !isRecord(value.fields) || !isRecord(value.pages)
    || !['confirmed', 'possible'].includes(String(value.identity))) return invalid('Choose the source document and business match.');
  const text = (key: string, limit: number): string => {
    const item = value[key];
    if (typeof item !== 'string' || !item.trim() || item.length > limit) return invalid('Enter the source name, report date, employer and business address.');
    return item.trim();
  };
  const source_date = text('source_date', 10);
  if (!validEvidenceDate(source_date) || source_date > today) return invalid('Use the document report date, not a future date.');
  const kind = value.kind as WcEvidence['kind'];
  const fields: WcEvidence['fields'] = {}, pages: WcEvidence['pages'] = {};
  for (const [key, raw] of Object.entries(value.fields)) {
    if (!Object.hasOwn(WC_FIELDS, key) || !wcFieldsFor(kind).includes(key as WcField)
      || typeof raw !== 'string' || raw.length > 200) return invalid('Use only the reported employer-level fields for this document.');
    const field = key as WcField, entry = raw.trim();
    if (!entry) continue;
    if (WC_FIELDS[field][1] === 'date' && !validEvidenceDate(entry)) return invalid(`Enter a valid ${WC_FIELDS[field][0].toLowerCase()}.`);
    if (WC_FIELDS[field][1] === 'number' && (!/^\d+(?:\.\d{1,4})?$/.test(entry) || !Number.isFinite(Number(entry))
      || Number(entry) > 1e12)) return invalid(`Enter ${WC_FIELDS[field][0].toLowerCase()} without commas or currency symbols.`);
    if (['claim_count', 'open_claims'].includes(field) && !Number.isSafeInteger(Number(entry))) return invalid('Claim counts must be whole numbers.');
    if (field === 'class_codes' && !/^\d{4}(?:\s*,\s*\d{4})*$/.test(entry)) return invalid('Use four-digit class codes separated by commas.');
    if (field === 'class_state' && !/^[A-Z]{2}$/.test(entry)) return invalid('Use the two-letter class code state.');
    if (field === 'payroll_basis' && !['estimated', 'reported', 'audited'].includes(entry)) return invalid('Choose estimated, reported or audited payroll.');
    if (field === 'loss_completeness' && !['complete', 'partial'].includes(entry)) return invalid('Choose complete or partial loss history.');
    fields[field] = entry;
  }
  for (const [key, page] of Object.entries(value.pages)) {
    if (!Object.hasOwn(fields, key) || typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > 1000) return invalid('Use a valid page number for each cited field.');
    pages[key as WcField] = page;
  }
  for (const [start, end] of [['policy_from', 'policy_to'], ['mod_from', 'mod_to'], ['payroll_from', 'payroll_to'], ['loss_from', 'loss_to']] as const) {
    if (fields[start] && fields[end] && fields[start] > fields[end]) return invalid('The period end must be on or after its start.');
  }
  if (fields.open_claims && fields.claim_count && Number(fields.open_claims) > Number(fields.claim_count)) return invalid('Open claims cannot exceed total claims.');
  if (fields.class_codes && !fields.class_state) return invalid('Add the state printed with the class codes.');
  if (fields.payroll && (!fields.payroll_basis || !fields.payroll_from || !fields.payroll_to)) return invalid('Add the payroll basis and period.');
  if ((fields.payroll_to && fields.payroll_to > source_date) || (fields.loss_to && fields.loss_to > source_date)) {
    return invalid('Payroll and loss history cannot extend beyond the document report date.');
  }
  if (fields.experience_mod !== undefined && Number(fields.experience_mod) <= 0) return invalid('The reported experience mod must be greater than zero.');
  if (['claim_count', 'open_claims', 'paid_losses', 'incurred_losses'].some((key) => fields[key as WcField])
    && (!fields.loss_from || !fields.loss_to || !fields.loss_completeness)) return invalid('Add the loss period and whether the history is complete.');
  return { kind, source_name: text('source_name', 160), source_date, employer_name: text('employer_name', 160),
    employer_address: text('employer_address', 200), identity: value.identity as WcEvidence['identity'], fields, pages };
}

export function wcEntryStatus(entry: WcEntry, today: string): string {
  if (entry.evidence.identity !== 'confirmed') return 'Possible business match';
  const fields = entry.evidence.fields;
  const to = fields.policy_to ?? fields.mod_to;
  const from = fields.policy_from ?? fields.mod_from;
  if (from && from > today) return 'Future period';
  if (to && to < today) return 'Historical period';
  if ((Date.parse(today) - Date.parse(entry.evidence.source_date)) / 86400000 > 90) return 'Needs a current document';
  return 'Producer-reviewed document';
}

export function wcMatchingFacts(entries: WcEntry[], today: string): { facts: OpportunityProfile['facts']; conflicts: string[] } {
  const values = new Map<BusinessField, Set<string>>();
  const add = (field: BusinessField, value: string): void => { const set = values.get(field) ?? new Set<string>(); set.add(value); values.set(field, set); };
  const current = entries.filter((entry) => wcEntryStatus(entry, today) === 'Producer-reviewed document');
  for (const { evidence } of current) {
    const f = evidence.fields;
    if (f.class_codes && f.class_state === 'AZ') {
      for (const code of f.class_codes.split(',').map((code) => code.trim())) add('class_code', code);
    }
    if (evidence.kind === 'mod' && f.experience_mod && f.mod_from && f.mod_to && f.mod_from <= today && f.mod_to >= today) add('experience_mod', String(Number(f.experience_mod)));
    if (evidence.kind === 'payroll' && f.payroll && f.payroll_basis === 'audited' && f.payroll_from && f.payroll_to && f.payroll_to <= today) {
      const days = (Date.parse(f.payroll_to) - Date.parse(f.payroll_from)) / 86400000;
      const age = (Date.parse(today) - Date.parse(f.payroll_to)) / 86400000;
      if (days >= 364 && days <= 366 && age <= 366) add('annual_payroll', String(Number(f.payroll)));
    }
    // Loss history is not mapped to the unqualified has_prior_losses field.
    // A report-period zero does not establish that the business has never had losses.
  }
  const facts: OpportunityProfile['facts'] = { state: 'AZ', line: 'workers compensation' }, conflicts: string[] = [];
  for (const [field, set] of values) {
    if (set.size === 1) facts[field] = [...set][0];
    else conflicts.push(field === 'class_code' ? 'Multiple class codes: compare each class with the guide.' : `Different ${field.replace(/_/g, ' ')} values: reconcile the source documents.`);
  }
  return { facts, conflicts };
}

export function suggestWcFields(pages: Pick<IntakePage, 'page' | 'text'>[], kind: WcEvidence['kind']): Pick<WcEvidence, 'fields' | 'pages'> {
  const fields: WcEvidence['fields'] = {}, citations: WcEvidence['pages'] = {};
  const ambiguous = new Set<WcField>();
  const patterns: Partial<Record<WcField, RegExp>> = {
    experience_mod: /^(?:experience (?:rating )?mod(?:ifier|ification factor)?|experience modification)\s*[:=]\s*(\d+(?:\.\d+)?)\s*$/i,
    payroll: /^(?:total (?:audited |reported |estimated )?payroll)\s*[:=]\s*\$?([\d,]+(?:\.\d{1,2})?)\s*$/i,
    claim_count: /^(?:total claims|claim count)\s*[:=]\s*(\d+)\s*$/i,
    open_claims: /^open claims\s*[:=]\s*(\d+)\s*$/i,
    paid_losses: /^(?:total paid|paid losses)\s*[:=]\s*\$?([\d,]+(?:\.\d{1,2})?)\s*$/i,
    incurred_losses: /^(?:total incurred|incurred losses)\s*[:=]\s*\$?([\d,]+(?:\.\d{1,2})?)\s*$/i,
  };
  for (const page of pages) for (const line of page.text.split(/\r?\n/)) for (const field of wcFieldsFor(kind)) {
    const match = patterns[field]?.exec(line.trim());
    if (!match) continue;
    const value = match[1].replace(/,/g, '');
    if (fields[field] !== undefined && fields[field] !== value) ambiguous.add(field);
    else { fields[field] = value; citations[field] = page.page; }
  }
  for (const field of ambiguous) { delete fields[field]; delete citations[field]; }
  return { fields, pages: citations };
}
