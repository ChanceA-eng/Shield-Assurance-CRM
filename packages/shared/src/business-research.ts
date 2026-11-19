import { NAICS_2022 } from './data/naics-2022.js';

export type ResearchSource = 'fmcsa_census' | 'osm' | 'irs' | 'dol_5500';
export const RESEARCH_NAICS = NAICS_2022;
export const RESEARCH_TAXONOMY_VERSION = 'naics-2022-osm-browse-v5';
export function researchNaicsMatches(reported: string | null, selected: string): boolean {
  if (!reported || !selected) return false;
  if (!selected.includes('-')) return reported.startsWith(selected);
  const [first, last] = selected.split('-').map(Number), sector = Number(reported.slice(0, 2));
  return Number.isInteger(sector) && sector >= first && sector <= last;
}
export const RESEARCH_INDUSTRIES = [
  { id: 'trucking', label: 'DOT-registered fleets', naics: [], osm: null },
  { id: 'restaurant', label: 'Restaurants and cafes', naics: ['722'], osm: ['amenity', 'restaurant|cafe|fast_food'] },
  { id: 'contractor', label: 'Construction and trades', naics: ['23'], osm: ['craft', 'builder|roofer|plumber|electrician|carpenter|hvac'] },
  { id: 'retail', label: 'Retail businesses', naics: ['44', '45'], osm: ['shop', '.'] },
  { id: 'automotive', label: 'Auto repair', naics: ['8111'], osm: ['shop', 'car_repair|tyres'] },
  { id: 'hospitality', label: 'Hotels and lodging', naics: ['721'], osm: ['tourism', 'hotel|motel|guest_house'] },
  { id: 'nonprofit', label: 'Nonprofit organizations', naics: [], osm: null },
  { id: 'manufacturing', label: 'Manufacturing', naics: ['31-33'], osm: ['man_made', 'works'] },
  { id: 'professional', label: 'Professional services', naics: ['54'], osm: ['office', 'lawyer|accountant|architect|engineer|it|consulting|advertising'] },
  { id: 'real_estate', label: 'Real estate', naics: ['531'], osm: ['office', 'estate_agent|property_management'] },
  { id: 'wholesale', label: 'Wholesale businesses', naics: ['42'], osm: ['shop', 'wholesale'] },
  { id: 'personal_services', label: 'Personal services', naics: ['812'], osm: ['shop', 'hairdresser|beauty|laundry|dry_cleaning'] },
] as const;
export const RESEARCH_NAICS_CATEGORIES = [
  { prefix: '722511', industry: 'restaurant', osm: ['amenity', '^restaurant$'] },
  { prefix: '722513', industry: 'restaurant', osm: ['amenity', '^fast_food$'] },
  { prefix: '722515', industry: 'restaurant', osm: ['amenity', '^(cafe|ice_cream)$'] },
  { prefix: '7224', industry: 'restaurant', osm: ['amenity', '^(bar|pub)$'] },
  { prefix: '722', industry: 'restaurant', osm: ['amenity', 'restaurant|cafe|fast_food|bar|pub|ice_cream'] },
  { prefix: '238160', industry: 'contractor', osm: ['craft', '^roofer$'] },
  { prefix: '238210', industry: 'contractor', osm: ['craft', '^electrician$'] },
  { prefix: '238220', industry: 'contractor', osm: ['craft', '^(plumber|hvac)$'] },
  { prefix: '238350', industry: 'contractor', osm: ['craft', '^carpenter$'] },
  { prefix: '23', industry: 'contractor', osm: ['craft', 'builder|roofer|plumber|electrician|carpenter|hvac'] },
  { prefix: '8111', industry: 'automotive', osm: ['shop', 'car_repair|tyres'] },
  { prefix: '721', industry: 'hospitality', osm: ['tourism', 'hotel|motel|guest_house|camp_site|caravan_site'] },
  { prefix: '44-45', industry: 'retail', osm: ['shop', '.'] },
  { prefix: '44', industry: 'retail', osm: ['shop', '.'] },
  { prefix: '45', industry: 'retail', osm: ['shop', '.'] },
  { prefix: '31-33', industry: 'manufacturing', osm: ['man_made', '^works$'] },
  { prefix: '31', industry: 'manufacturing', osm: ['man_made', '^works$'] },
  { prefix: '32', industry: 'manufacturing', osm: ['man_made', '^works$'] },
  { prefix: '33', industry: 'manufacturing', osm: ['man_made', '^works$'] },
  { prefix: '5411', industry: 'professional', osm: ['office', '^lawyer$'] },
  { prefix: '5412', industry: 'professional', osm: ['office', '^accountant$'] },
  { prefix: '5413', industry: 'professional', osm: ['office', '^(architect|engineer)$'] },
  { prefix: '5415', industry: 'professional', osm: ['office', '^it$'] },
  { prefix: '5416', industry: 'professional', osm: ['office', '^consulting$'] },
  { prefix: '5418', industry: 'professional', osm: ['office', '^advertising$'] },
  { prefix: '54', industry: 'professional', osm: ['office', 'lawyer|accountant|architect|engineer|it|consulting|advertising'] },
  { prefix: '531', industry: 'real_estate', osm: ['office', 'estate_agent|property_management'] },
  { prefix: '42', industry: 'wholesale', osm: ['shop', '^wholesale$'] },
  { prefix: '8121', industry: 'personal_services', osm: ['shop', 'hairdresser|beauty'] },
  { prefix: '8123', industry: 'personal_services', osm: ['shop', 'laundry|dry_cleaning'] },
  { prefix: '812', industry: 'personal_services', osm: ['shop', 'hairdresser|beauty|laundry|dry_cleaning'] },
] as const;
export function researchNaicsCategory(code: string): typeof RESEARCH_NAICS_CATEGORIES[number] | undefined {
  return [...RESEARCH_NAICS_CATEGORIES].sort((a, b) => b.prefix.length - a.prefix.length)
    .find((item) => code === item.prefix || !item.prefix.includes('-') && code.startsWith(item.prefix));
}
export interface ResearchPlace { id: string; name: string; label: string; latitude: number; longitude: number }
export const RESEARCH_US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR VI GU AS MP'.split(' ');
export interface BusinessSearchFilters {
  query: string;
  industry: string;
  naics: string;
  state: string;
  city: string;
  zip: string;
  place_id: string;
  radius_miles: string;
  contact: string;
  min_power_units: string;
  max_power_units: string;
  min_revenue: string;
  max_revenue: string;
  map_bounds: string;
  benefits: string;
  min_participants: string;
  max_participants: string;
}
export const EMPTY_BUSINESS_SEARCH: BusinessSearchFilters = { query: '', industry: '', naics: '', state: '', city: '', zip: '',
  place_id: '', radius_miles: '', contact: '', min_power_units: '', max_power_units: '', min_revenue: '', max_revenue: '',
  map_bounds: '', benefits: '', min_participants: '', max_participants: '' };
export interface BusinessObservation {
  source: ResearchSource;
  record_id: string;
  url: string;
  fetched_at: string;
  source_as_of: string | null;
  index_partition?: string;
  values: {
    name: string;
    street: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    latitude: number | null;
    longitude: number | null;
    industry: string | null;
    naics: string | null;
    classification: 'reported' | 'mapped' | 'unknown';
    dot: string | null;
    ein: string | null;
    power_units: number | null;
    drivers: number | null;
    registration_reported_on: string | null;
    filing_year: string | null;
    assets: number | null;
    revenue: number | null;
    map_tags?: Record<string, string>;
    filing_document?: { object_id: string; batch: string; tax_period: string; submission_year: string; return_type: '990' | '990EZ' | '990PF' };
    benefits?: {
      plan_name: string; plan_number: string; period_end: string | null; received_on: string | null;
      participants: number | null; active_participants: number | null; pension_codes: string | null; welfare_codes: string | null;
      business_code: string | null;
      filing_id?: string;
      contracts?: Array<{ insurer: string | null; naic: string | null; policy_from: string | null; policy_to: string | null; url: string }>;
    };
  };
}
export interface ResearchCoverage {
  source: ResearchSource;
  state: 'complete' | 'partial' | 'unavailable' | 'not_applicable';
  message: string;
}
export interface ResearchBusiness {
  id: string;
  name: string;
  observations: BusinessObservation[];
  updated_at: string;
  status: 'ready' | 'partial';
  linked_record?: { type: 'lead' | 'client'; id: string } | null;
  /** Live Google Maps listing matched by the OIP; returned per request and never stored. */
  google?: GooglePlace | null;
  distance_miles?: number | null;
}
export interface GoogleSearchCoverage {
  state: 'complete' | 'unavailable' | 'not_applicable';
  message: string;
  /** Google listings that matched no public record on this page. */
  places: GooglePlace[];
  next_page_token: string | null;
}
export interface BusinessSearchResult {
  run_id: string;
  businesses: ResearchBusiness[];
  coverage: ResearchCoverage[];
  next_page: number | null;
  google?: GoogleSearchCoverage;
  center?: { latitude: number; longitude: number; radius_miles: number | null } | null;
}
export interface GooglePlace {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  maps_url: string | null;
  category: string | null;
  rating: number | null;
  rating_count: number | null;
  status: string | null;
  latitude: number | null;
  longitude: number | null;
  distance_miles?: number | null;
}
export type GooglePlacesResult =
  | { configured: false; message: string }
  | { configured: true; places: GooglePlace[]; next_page_token: string | null; used: number; cap: number };
export interface BusinessResearchProfile {
  business: ResearchBusiness | null;
  linked_record: { type: 'lead' | 'client'; id: string } | null;
  branches?: Array<{ id: string; name: string }>;
  readiness?: { active_carrier_documents: number; osha_configured: boolean; fmcsa_configured: boolean };
  job: { state: 'pending' | 'processing' | 'complete' | 'failed'; paused?: boolean; error: string | null; result: ResearchJobResult | null } | null;
}
export interface ResearchInsight { kind: 'fact' | 'question' | 'conflict'; text: string; sources: string[] }
export interface ResearchFinancials {
  ein: string; period_end: string; return_type: '990' | '990EZ' | '990PF'; object_id: string;
  revenue: number | null; assets: number | null; expenses: number | null; employees: number | null; url: string;
}
export interface ResearchJobResult {
  research_version?: number;
  insights: ResearchInsight[];
  coverage: Array<{ source: string; state: 'complete' | 'unavailable' | 'not_applicable'; message: string }>;
  context: Array<{ category: 'fleet' | 'property' | 'weather' | 'workplace'; label: string; value: string; url: string; fetched_at: string }>;
  financials?: ResearchFinancials;
  market_fit: import('./opportunities.js').OpportunityAssessment | null;
  fmcsa_candidates?: Array<{
    dot_number: string; legal_name: string; dba_name: string | null; physical_address: string | null;
    city: string | null; state: string | null; phone: string | null; power_units: number | null;
    drivers: number | null; operating_status: string | null; safety_rating: string | null;
    inspections_total: number | null; crashes_total: number | null; fetched_at: string;
  }>;
  osha_candidates?: Array<{
    activity_nr: string; establishment: string; street: string | null; city: string | null;
    state: string | null; zip: string | null; open_date: string | null;
  }>;
}
