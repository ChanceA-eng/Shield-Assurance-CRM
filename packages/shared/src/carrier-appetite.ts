export const APPETITE_DECISIONS = ['preferred', 'eligible', 'excluded', 'referral', 'condition', 'needs_review'] as const;
export type AppetiteDecision = typeof APPETITE_DECISIONS[number];
export const CARRIER_ACCESS = ['unconfirmed', 'direct', 'mga_wholesaler', 'unavailable'] as const;
export type CarrierAccess = typeof CARRIER_ACCESS[number];
export interface CarrierAppetiteRule {
  id: string;
  carrier?: string;
  criterion: string;
  decision: AppetiteDecision;
  page: number;
  excerpt: string;
  predicate?: AppetitePredicate;
}
export interface CarrierAppetiteValues {
  carrier: string;
  title: string;
  line: string;
  states: string;
  effective_on: string;
  expires_on: string;
  access: CarrierAccess;
  access_reference: string;
  rights_reference: string;
  interpretation?: { version: string; source_hash: string; summary: string };
  unresolved_entries?: Array<{ criterion: string; page: number | null; reason: string }>;
  rules: CarrierAppetiteRule[];
}
export function appetiteCoverage(line: string): string[] {
  const aliases: Record<string, string> = {
    auto: 'commercial auto', 'business auto': 'commercial auto', fleet: 'commercial auto',
    'commercial automobile': 'commercial auto', property: 'commercial property',
    gl: 'general liability', 'workers comp': 'workers compensation', wc: 'workers compensation',
  };
  return line.split(/[,;\n]/).map((part) => {
    const key = part.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
    return aliases[key] ?? key;
  }).filter(Boolean);
}
export function appetiteScopesOverlap(left: Pick<CarrierAppetiteValues, 'carrier' | 'line' | 'states'>,
  right: Pick<CarrierAppetiteValues, 'carrier' | 'line' | 'states'>): boolean {
  if (left.carrier.trim().toLowerCase() !== right.carrier.trim().toLowerCase()) return false;
  const a = appetiteCoverage(left.line), b = appetiteCoverage(right.line);
  if (a.length && b.length && !a.some((line) => b.includes(line))) return false;
  const states = (text: string): string[] => text.split(/[,;\n]/).map((state) => state.trim().toUpperCase()).filter(Boolean);
  const x = states(left.states), y = states(right.states);
  return !x.length || !y.length || x.includes('ALL') || y.includes('ALL') || x.some((state) => y.includes(state));
}
export interface CarrierAppetiteDocument {
  id: string;
  revision: number;
  state: 'draft' | 'active' | 'withdrawn';
  values: CarrierAppetiteValues;
  file_name: string;
  storage_path: string;
  pages: Array<{ page: number; text: string }>;
  approved_by: string | null;
  approved_at: string | null;
}
export function carrierAppetiteAvailability(document: Pick<CarrierAppetiteDocument, 'state' | 'values'>, today = new Date().toISOString().slice(0, 10)): string {
  if (document.state !== 'active') return document.state === 'withdrawn' ? 'Withdrawn' : 'Saved draft';
  if (document.values.effective_on > today) return 'Not yet effective';
  if (document.values.expires_on && document.values.expires_on < today) return 'Expired';
  if (document.values.access === 'unconfirmed') return 'Agency access unconfirmed';
  if (document.values.access === 'unavailable') return 'Agency access unavailable';
  return 'Available for matching';
}
import type { AppetitePredicate } from './opportunities.js';
