import { isRecord, isUuid } from './workspace-validation';
import { arizonaDateTimeInput } from './arizona-time';

export interface PolicyConfirmation {
  confirmed_on: string;
  reference: string;
  file_id: string | null;
  attested: true;
}

export function policyConfirmation(value: unknown): PolicyConfirmation {
  if (!isRecord(value) || value.attested !== true) throw new Error('Attest to the carrier confirmation evidence before recording coverage.');
  const date = typeof value.confirmed_on === 'string' ? value.confirmed_on : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > arizonaDateTimeInput(new Date()).slice(0, 10)) {
    throw new Error('Enter a valid carrier confirmation date that is not in the future.');
  }
  const reference = typeof value.reference === 'string' ? value.reference.trim() : '';
  const fileId = value.file_id === null || value.file_id === undefined || value.file_id === '' ? null : value.file_id;
  if (fileId !== null && !isUuid(fileId)) throw new Error('Choose a valid carrier confirmation document.');
  if (reference.length > 500 || (!fileId && !reference)) throw new Error('Supply an uploaded carrier document or a carrier confirmation reference (up to 500 characters).');
  return { confirmed_on: date, reference, file_id: fileId, attested: true };
}
