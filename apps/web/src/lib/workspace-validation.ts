import { ASSET_FIELDS, isAssetKind, isAssetSource, type AssetDetails, type AssetKind, type AssetSource } from '@crm/shared';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function absoluteDateTime(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return null;
  }
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || (/^:\d{2}/.test(value.slice(16)) && Number(value.slice(17, 19)) > 59)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) return null;
  return parsed.toISOString();
}

export interface ValidatedAsset {
  title: string;
  asset_type: AssetKind;
  details: AssetDetails;
  source: AssetSource;
  source_reference: string | null;
}

export function validateAsset(value: unknown): ValidatedAsset | string {
  if (!isRecord(value)) return 'An asset object is required.';
  if (typeof value.title !== 'string' || !value.title.trim()) return 'Give this asset a name.';
  if (value.title.trim().length > 200) return 'Asset names must be 200 characters or fewer.';
  if (!isAssetKind(value.asset_type)) return 'Choose a supported asset type.';
  if (!isAssetSource(value.source)) return 'Choose how these details were obtained.';
  if (value.source_reference !== undefined && value.source_reference !== null && typeof value.source_reference !== 'string') return 'The source reference must be text.';
  const sourceReference = typeof value.source_reference === 'string' ? value.source_reference.trim() : '';
  if (sourceReference.length > 2000) return 'The source reference is too long.';
  if (['website', 'import', 'government'].includes(value.source) && !sourceReference) return 'Add the submission, import or government-record reference for this source.';
  if (!isRecord(value.details)) return 'Asset details must be an object.';

  const allowed = new Set<string>([...ASSET_FIELDS[value.asset_type].map((field) => field.key), 'notes']);
  for (const [key, field] of Object.entries(value.details)) {
    if (!allowed.has(key)) return `The ${key} field does not belong to this asset type.`;
    if (typeof field !== 'string') return `The ${key} field must be text.`;
    if (field.length > 4000) return `The ${key} field is too long.`;
  }

  const details: AssetDetails = {};
  for (const field of [...ASSET_FIELDS[value.asset_type], { key: 'notes' as const, label: 'Notes' }]) {
    const text = value.details[field.key];
    if (typeof text === 'string' && text.trim()) details[field.key] = text.trim();
  }
  if (details.year && (!/^\d{4}$/.test(details.year) || Number(details.year) < 1900 || Number(details.year) > new Date().getUTCFullYear() + 2)) {
    return 'Enter a valid four-digit vehicle year.';
  }
  if (details.vin && !(details.year && Number(details.year) < 1981 ? /^[a-z0-9]{5,17}$/i : /^[A-HJ-NPR-Z0-9]{17}$/i).test(details.vin)) {
    return 'A modern VIN must contain 17 letters or digits (no I, O, or Q). For a pre-1981 vehicle, enter its year first. Leave unknown VINs empty.';
  }
  if (details.vin) details.vin = details.vin.toUpperCase();
  if (details.mileage && (!/^\d+$/.test(details.mileage.replace(/,/g, '')) || Number(details.mileage.replace(/,/g, '')) < 0)) {
    return 'Annual mileage must be a non-negative whole number.';
  }
  return { title: value.title.trim(), asset_type: value.asset_type, details, source: value.source, source_reference: sourceReference || null };
}
