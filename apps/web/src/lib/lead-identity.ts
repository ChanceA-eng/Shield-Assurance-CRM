/**
 * Lead identity matching: normalizes names/contacts so duplicate detection,
 * merging, and import grouping all agree on what "the same lead" means.
 */

/** Vendor contract-award prefixes like "CPX2024XMS021X0023 - ". */
const CONTRACT_PREFIX = /^[A-Z]{2,4}\d{0,4}X[A-Z0-9]+X\d+\s*-\s*/i;
const COMPANY_SUFFIXES = /\b(incorporated|inc|llc|llp|ltd|corp|corporation|co|company)\b\.?/gi;

export function stripContractPrefix(name: string): { name: string; contract: string | null } {
  const match = name.match(CONTRACT_PREFIX);
  if (!match) return { name: name.trim(), contract: null };
  return {
    name: name.slice(match[0].length).trim(),
    contract: match[0].replace(/\s*-\s*$/, '').trim(),
  };
}

export function normalizeCompanyName(name: string): string {
  return stripContractPrefix(name)
    .name.toLowerCase()
    .replace(COMPANY_SUFFIXES, '')
    .replace(/[^a-z0-9]/g, '');
}

export function phoneKey(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

export function emailKey(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** Small-edit-distance similarity for typo variants (e.g. CONTRATING vs CONTRACTING). */
export function namesSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 6 || b.length < 6) return false;
  if (Math.abs(a.length - b.length) > 2) return false;

  const maxDistance = 2;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);

  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i];
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > maxDistance) return false;
    previous = current;
  }

  return previous[cols - 1] <= maxDistance;
}

export interface IdentityRecord {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
}

export interface DuplicateGroup<T extends IdentityRecord> {
  reason: string;
  records: T[];
}

/** Groups records that appear to be the same lead. */
export function findDuplicateGroups<T extends IdentityRecord>(records: T[]): DuplicateGroup<T>[] {
  const groups: DuplicateGroup<T>[] = [];
  const assigned = new Set<string>();

  const byEmail = new Map<string, T[]>();
  const byPhone = new Map<string, T[]>();
  for (const record of records) {
    const email = emailKey(record.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) ?? []), record]);
    const phone = phoneKey(record.phone);
    if (phone) byPhone.set(phone, [...(byPhone.get(phone) ?? []), record]);
  }

  const take = (members: T[], reason: string): void => {
    const fresh = members.filter((member) => !assigned.has(member.id));
    if (fresh.length < 2) return;
    fresh.forEach((member) => assigned.add(member.id));
    groups.push({ reason, records: fresh });
  };

  for (const [email, members] of byEmail) {
    take(members, `Same email (${email})`);
  }
  for (const [, members] of byPhone) {
    take(members, 'Same phone number');
  }

  // Normalized-name matches (contract variants collapse here), plus fuzzy typo pass.
  const byName = new Map<string, T[]>();
  for (const record of records) {
    if (assigned.has(record.id)) continue;
    const key = normalizeCompanyName(record.full_name);
    if (key.length < 4) continue;
    byName.set(key, [...(byName.get(key) ?? []), record]);
  }
  const nameKeys = [...byName.keys()];
  const mergedKeys = new Set<string>();
  for (let i = 0; i < nameKeys.length; i++) {
    if (mergedKeys.has(nameKeys[i])) continue;
    let members = byName.get(nameKeys[i]) ?? [];
    for (let j = i + 1; j < nameKeys.length; j++) {
      if (mergedKeys.has(nameKeys[j])) continue;
      if (namesSimilar(nameKeys[i], nameKeys[j])) {
        members = [...members, ...(byName.get(nameKeys[j]) ?? [])];
        mergedKeys.add(nameKeys[j]);
      }
    }
    take(members, 'Same or similar company name');
  }

  return groups;
}
