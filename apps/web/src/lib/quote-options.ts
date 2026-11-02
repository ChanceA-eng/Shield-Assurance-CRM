import { WorkspaceError } from './record-scope';

export const QUOTE_STATUSES = ['draft', 'presented', 'accepted', 'declined'] as const;
export type QuoteStatus = typeof QUOTE_STATUSES[number];
export interface QuoteFields {
  carrier: string;
  line_of_business: string;
  premium: number;
  effective_date: string | null;
  expiration_date: string | null;
  limits: string;
  deductibles: string;
  notes: string;
  status: QuoteStatus;
}
export interface QuoteOption extends QuoteFields {
  id: string;
  client_id: string;
  lead_id: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string;
}
export interface QuoteHistoryEntry {
  id: string;
  quote_id: string;
  changed_at: string;
  snapshot: QuoteOption & { created_by: string; source_lead_id: string | null };
}
export function quoteFields(body: Record<string, unknown>): QuoteFields {
  const text = (key: string, max: number, required = false): string => {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim())) {
      throw new WorkspaceError(`Enter a valid ${key.replaceAll('_', ' ')} (maximum ${max} characters).`, 400);
    }
    return value.trim();
  };
  if ((typeof body.premium !== 'number' && typeof body.premium !== 'string')
    || (typeof body.premium === 'string' && !body.premium.trim())) throw new WorkspaceError('Enter the quoted premium.', 400);
  const premium = Number(body.premium);
  if (!Number.isFinite(premium) || premium < 0 || premium > 999999999999.99 || Math.abs(premium * 100 - Math.round(premium * 100)) > 0.0001) {
    throw new WorkspaceError('Premium must be a non-negative amount with at most two decimal places.', 400);
  }
  const date = (key: string): string | null => {
    const value = text(key, 10);
    if (!value) return null;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new WorkspaceError(`Enter a valid ${key.replaceAll('_', ' ')}.`, 400);
    }
    return value;
  };
  const effective_date = date('effective_date'), expiration_date = date('expiration_date');
  if (effective_date && expiration_date && expiration_date <= effective_date) throw new WorkspaceError('Expiration must be after the effective date.', 400);
  const status = QUOTE_STATUSES.find((value) => value === body.status);
  if (!status) throw new WorkspaceError('Select a valid quote status.', 400);
  return { carrier: text('carrier', 160, true), line_of_business: text('line_of_business', 120, true), premium,
    effective_date, expiration_date, limits: text('limits', 4000), deductibles: text('deductibles', 4000), notes: text('notes', 8000), status };
}
