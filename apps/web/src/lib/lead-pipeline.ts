/**
 * Lead pipeline vocabulary — single source of truth.
 * Canonical flow: new -> contacted -> quoted -> won / lost / inactive.
 */

export const ACTIVE_LEAD_STATUSES = ['new', 'contacted', 'quoted'] as const;
export const TERMINAL_LEAD_STATUSES = ['won', 'lost', 'inactive'] as const;
export const LEAD_STATUSES = [...ACTIVE_LEAD_STATUSES, ...TERMINAL_LEAD_STATUSES] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
  inactive: 'Inactive',
};

export const LOST_REASONS = [
  'price',
  'carrier_declined',
  'unresponsive',
  'bought_elsewhere',
  'other',
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: 'Price',
  carrier_declined: 'Carrier declined',
  unresponsive: 'Unresponsive',
  bought_elsewhere: 'Bought elsewhere',
  other: 'Other',
};

/** Maps any legacy or external alias to a canonical status; null when unrecognized. */
export function normalizeLeadStatus(input: string): LeadStatus | null {
  const value = input.trim().toLowerCase();

  const aliases: Record<string, LeadStatus> = {
    lead: 'new',
    new: 'new',
    prospect: 'contacted',
    working: 'contacted',
    contacted: 'contacted',
    quoted: 'quoted',
    bound: 'won',
    renewal: 'won',
    closed: 'won',
    won: 'won',
    lost: 'lost',
    inactive: 'inactive',
    dormant: 'inactive',
  };

  return aliases[value] ?? null;
}

export function isActiveLeadStatus(status: string): boolean {
  return (ACTIVE_LEAD_STATUSES as readonly string[]).includes(status);
}
