import { timingSafeEqual } from 'node:crypto';

type Json = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A website "Push to pipeline" is trusted only when it carries the shared website sync token. */
export function isAuthorizedWebsitePush(payload: Json, authorization: string | null, token = process.env.WEBSITE_SYNC_TOKEN): boolean {
  if (payload.pipeline_push !== true) return false;
  const expected = token?.trim();
  const provided = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || !provided) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  return a.length === b.length && timingSafeEqual(a, b);
}

const FILLABLE: Array<[column: string, fields: string[]]> = [
  ['zip', ['zip']],
  ['state', ['state']],
  ['business', ['business']],
  ['industry', ['industry']],
  ['address', ['address']],
  ['primary_coverage', ['primaryCoverage']],
  ['vehicle_details', ['vehicleDetails']],
  ['details', ['details', 'message']],
];

/** The old daily pull stored a raw "KEY: value" dump instead of the visitor's words; that dump may be replaced. */
export const isMachineDetailsDump = (value: unknown): boolean => typeof value === 'string' && /^ID: [^\n]*\nCREATED_AT: /.test(value);

/** Fills only empty card columns from the real submission; anything a producer typed is never overwritten. */
export function missingFieldUpdates(card: Json, payload: Json): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const [column, fields] of FILLABLE) {
    const value = fields.map((field) => text(payload[field])).find(Boolean);
    const replaceable = !text(card[column]) || (column === 'details' && isMachineDetailsDump(card[column]));
    if (value && replaceable && value !== card[column]) updates[column] = value;
  }
  const line = text(payload.line_of_business);
  const currentLine = text(card.line_of_business);
  if (line && (!currentLine || currentLine === 'General Request')) updates.line_of_business = line;
  const bundles = Array.isArray(payload.bundles) ? payload.bundles.map(text).filter(Boolean) : [];
  if (bundles.length && !(Array.isArray(card.bundles) && card.bundles.length)) updates.bundles = bundles;
  return updates;
}

export const FILLABLE_COLUMNS = 'id,zip,state,business,industry,address,primary_coverage,vehicle_details,details,line_of_business,bundles';
