const CLAIM_STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  open: ['open', 'in_review', 'closed'],
  in_review: ['open', 'in_review', 'closed'],
  closed: ['closed', 'reopened'],
  reopened: ['reopened', 'open', 'in_review', 'closed'],
};

export function canTransitionClaimStatus(current: string, next: string): boolean {
  return CLAIM_STATUS_TRANSITIONS[current.toLowerCase()]?.includes(next.toLowerCase()) ?? current === next;
}

export function claimAmount(value: unknown, label: string): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number.`);
  return parsed;
}
