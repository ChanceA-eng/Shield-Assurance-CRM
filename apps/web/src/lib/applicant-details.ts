import occupations from './data/occupations.json';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { OCCUPATION_INDUSTRIES, occupationIndustry } from './occupation-industries';

export const OCCUPATIONS = occupations;
export const EMPLOYMENT_STATUSES = ['Employed', 'Self-employed', 'Retired', 'Student', 'Homemaker', 'Not currently employed', 'Other'];
export const LICENSE_STATUSES = ['Valid', 'Permit', 'Suspended', 'Revoked', 'Expired', 'Not licensed', 'Other'];
export const RESIDENCE_STATUSES = ['Own', 'Rent', 'Live with family', 'Other'];
export interface PreviousAddress { address: string; from: string; to: string; years_at_address?: string; months_at_address?: string }
export interface AddressHistory {
  years_at_address: string; months_at_address: string; residence_status: string; previous_addresses: PreviousAddress[];
}
export interface LicenseDetails {
  license_number?: string; license_state: string; license_class?: string; license_status?: string;
  license_issued?: string; license_expires?: string; years_licensed?: string;
}
export interface IntakeDriver extends LicenseDetails, Partial<AddressHistory> { name: string; dob: string; relationship: string; address?: string }
export interface ApplicantDetails {
  dob: string; marital_status: string; occupation: string; occupation_code: string;
  occupation_industry?: string;
  employment_status: string; employer: string; years_employed: string;
  years_at_address: string; months_at_address: string; residence_status: string;
  previous_addresses: PreviousAddress[]; requested_effective: string; requested_expiration: string;
}
export const EMPTY_APPLICANT: ApplicantDetails = {
  dob: '', marital_status: '', occupation: '', occupation_code: '', employment_status: '', employer: '', years_employed: '',
  occupation_industry: '',
  years_at_address: '', months_at_address: '', residence_status: '', previous_addresses: [], requested_effective: '', requested_expiration: '',
};
export const EMPTY_DRIVER: IntakeDriver = { name: '', dob: '', relationship: '', license_state: '',
  license_number: '', license_class: '', license_status: '', license_issued: '', license_expires: '', years_licensed: '',
  address: '', years_at_address: '', months_at_address: '', residence_status: '', previous_addresses: [] };

function text(value: unknown, label: string, max = 200): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new WorkspaceError(`${label} must be text of at most ${max} characters.`, 400);
  return value.trim();
}
export function intakeDate(value: unknown, label: string, past = false): string {
  const date = text(value, label, 10);
  if (!date) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date
    || (past && (date < '1900-01-01' || parsed.getTime() > Date.now()))) throw new WorkspaceError(`${label} must be a valid${past ? ' past' : ''} date.`, 400);
  return date;
}
function duration(value: unknown, label: string, max = 120): string {
  const result = text(value, label, 6);
  if (result && (!/^\d+$/.test(result) || Number(result) > max)) throw new WorkspaceError(`${label} must be a whole number from 0 to ${max}.`, 400);
  return result;
}
function choice(value: unknown, options: readonly string[], label: string): string {
  const result = text(value, label);
  if (result && !options.includes(result)) throw new WorkspaceError(`Choose a valid ${label.toLowerCase()}.`, 400);
  return result;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new WorkspaceError(`${label} must be an object.`, 400);
  return value;
}
export function validateLicenseDetails(value: unknown): LicenseDetails {
  const record = object(value, 'License details');
  const license_issued = intakeDate(record.license_issued, 'License issue date', true);
  const license_expires = intakeDate(record.license_expires, 'License expiration date');
  if (license_issued && license_expires && license_expires < license_issued) throw new WorkspaceError('License expiration must not be before its issue date.', 400);
  return { license_number: text(record.license_number, 'License number', 40), license_state: text(record.license_state, 'License state', 2).toUpperCase(),
    license_class: text(record.license_class, 'License class', 40), license_status: choice(record.license_status, LICENSE_STATUSES, 'License status'),
    license_issued, license_expires, years_licensed: duration(record.years_licensed, 'Years licensed') };
}
export function validateAddressHistory(value: unknown): AddressHistory {
  const record = object(value, 'Address history');
  const addresses = record.previous_addresses ?? [];
  if (!Array.isArray(addresses) || addresses.length > 10) throw new WorkspaceError('Add at most 10 previous addresses.', 400);
  const previous_addresses = addresses.map((item) => {
    const row = object(item, 'Previous address');
    const address = text(row.address, 'Previous address', 300);
    const from = intakeDate(row.from, 'Previous address move-in date', true);
    const to = intakeDate(row.to, 'Previous address move-out date', true);
    if (from && to && to < from) throw new WorkspaceError('A previous address move-out date must not precede its move-in date.', 400);
    const years_at_address = duration(row.years_at_address, 'Years at previous address');
    const months_at_address = duration(row.months_at_address, 'Additional months at previous address', 11);
    return { address, from, to, ...(years_at_address ? { years_at_address } : {}), ...(months_at_address ? { months_at_address } : {}) };
  }).filter((row) => row.address || row.from || row.to || row.years_at_address || row.months_at_address);
  return {
    years_at_address: duration(record.years_at_address, 'Years at current address'), months_at_address: duration(record.months_at_address, 'Additional months at current address', 11),
    residence_status: choice(record.residence_status, RESIDENCE_STATUSES, 'Residence status'), previous_addresses,
  };
}
export function validateDriverAddress(value: unknown): AddressHistory & { address: string } {
  const record = object(value, 'Driver address');
  return { address: text(record.address, 'Driver address', 300), ...validateAddressHistory(record) };
}
export function validateApplicantDetails(value: unknown): ApplicantDetails {
  const record = object(value, 'Applicant details');
  const occupation_code = text(record.occupation_code, 'Occupation code', 20);
  const occupation = text(record.occupation, 'Occupation', 200);
  const occupation_industry = text(record.occupation_industry, 'Occupation industry', 20) || occupationIndustry(occupation_code);
  if (occupation_industry && !OCCUPATION_INDUSTRIES.some((row) => row.code === occupation_industry)) throw new WorkspaceError('Choose a valid occupation industry.', 400);
  if (occupation_code && (!OCCUPATIONS.some((item) => item.code === occupation_code && item.title === occupation)
    || occupationIndustry(occupation_code) !== occupation_industry)) {
    throw new WorkspaceError('Choose an occupation in the selected industry, or use Other to enter it manually.', 400);
  }
  const requested_effective = intakeDate(record.requested_effective, 'Requested coverage effective date');
  const requested_expiration = intakeDate(record.requested_expiration, 'Requested coverage expiration date');
  if (requested_effective && requested_expiration && requested_expiration <= requested_effective) throw new WorkspaceError('Requested coverage expiration must be after its effective date.', 400);
  return {
    dob: intakeDate(record.dob, 'Date of birth', true), marital_status: choice(record.marital_status, ['Single', 'Married', 'Domestic partner', 'Divorced', 'Widowed'], 'Marital status'),
    occupation, occupation_code, ...(occupation_industry ? { occupation_industry } : {}), employment_status: choice(record.employment_status, EMPLOYMENT_STATUSES, 'Employment status'),
    employer: text(record.employer, 'Employer'), years_employed: duration(record.years_employed, 'Years with employer'),
    ...validateAddressHistory(record), requested_effective, requested_expiration,
  };
}
export function applicantSections(value: ApplicantDetails): Array<{ title: string; fields: Array<{ label: string; value: string }> }> {
  const section = (title: string, entries: Array<[string, string]>) => ({ title, fields: entries.filter(([, value]) => value).map(([label, value]) => ({ label, value })) });
  return [
    section('Applicant details', [['Date of birth', value.dob], ['Marital status', value.marital_status], ['Occupation', value.occupation],
      ['Industry', OCCUPATION_INDUSTRIES.find((row) => row.code === value.occupation_industry)?.label ?? ''],
      ['Employment status', value.employment_status], ['Employer', value.employer], ['Years with employer', value.years_employed]]),
    section('Address history', [['Years at current address', value.years_at_address], ['Additional months at current address', value.months_at_address], ['Residence status', value.residence_status]]),
    ...value.previous_addresses.map((row, index) => section(`Previous address ${index + 1}`, [['Address', row.address], ['From', row.from], ['To', row.to]])),
    section('Requested coverage dates', [['Requested effective date', value.requested_effective], ['Requested expiration date', value.requested_expiration]]),
  ].filter((section) => section.fields.length);
}
export function driverFields(driver: IntakeDriver): Array<{ label: string; value: string }> {
  const fields = Object.entries({ Relationship: driver.relationship, 'Date of birth': driver.dob, 'License number': driver.license_number,
    'License state': driver.license_state, 'License class': driver.license_class, 'License status': driver.license_status,
    'License issued': driver.license_issued, 'License expires': driver.license_expires, 'Years licensed': driver.years_licensed,
    Address: driver.address, 'Years at current address': driver.years_at_address, 'Additional months at current address': driver.months_at_address,
    'Residence status': driver.residence_status })
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1]))
    .map(([label, value]) => ({ label, value }));
  for (const [index, row] of (driver.previous_addresses ?? []).entries()) {
    for (const [suffix, value] of [['', row.address], ['from', row.from], ['to', row.to], ['years', row.years_at_address], ['additional months', row.months_at_address]]) {
      if (value) fields.push({ label: `Previous address ${index + 1} ${suffix}`.trim(), value });
    }
  }
  return fields;
}
