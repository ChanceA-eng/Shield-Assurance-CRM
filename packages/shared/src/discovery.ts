export type DiscoveryReview = 'discovered' | 'needs_verification' | 'reviewed' | 'dismissed';

export interface DiscoveryFilters {
  query: string;
  industry: string;
  state: string;
  line: string;
  employees_min: number | null;
  employees_max: number | null;
  renewal_from: string;
  renewal_to: string;
  review: DiscoveryReview | 'all' | 'promoted';
  source_id: string;
}

export const EMPTY_DISCOVERY_FILTERS: DiscoveryFilters = {
  query: '', industry: '', state: '', line: '', employees_min: null, employees_max: null,
  renewal_from: '', renewal_to: '', review: 'all', source_id: '',
};

export interface DiscoverySource {
  id: string;
  name: string;
  permission_reference: string;
  approved_by: string;
  active: boolean;
  acquisition_until: string;
  created_at: string;
  updated_at: string;
  provider?: 'file' | 'fmcsa';
}

export interface PublicDiscoveryBusiness {
  dot_number: string;
  legal_name: string;
  address: string | null;
  state: string | null;
  phone: string | null;
  power_units: number | null;
  drivers: number | null;
  registration_reported_on: string | null;
  operating_status: string | null;
}

export interface PublicDiscoveryPage {
  businesses: PublicDiscoveryBusiness[];
  next_start: number | null;
  fetched_at: string;
}

export interface DiscoverySearch {
  id: string;
  name: string;
  filters: DiscoveryFilters;
  updated_at: string;
}

export interface DiscoveryCandidate {
  id: string;
  batch_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  disposition: string;
  duplicate_of: string | null;
  lead_id: string | null;
  discovery_review: DiscoveryReview;
  discovery_note: string;
  discovery_updated_at: string;
  file_name: string;
  source_name: string;
  source_active: boolean;
  acquired_at: string;
  profile: Record<string, unknown>;
}
