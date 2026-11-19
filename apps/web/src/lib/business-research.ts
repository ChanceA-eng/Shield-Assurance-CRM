import { createHash } from 'node:crypto';
import { EMPTY_BUSINESS_SEARCH, RESEARCH_INDUSTRIES, RESEARCH_NAICS, RESEARCH_US_STATES, researchNaicsCategory,
  type BusinessField, type BusinessObservation, type BusinessSearchFilters, type OpportunityProfile, type ResearchInsight, validEvidenceDate } from '@crm/shared';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';
import { researchPlace } from './research-geography';

export function researchIndustry(filters: BusinessSearchFilters): typeof RESEARCH_INDUSTRIES[number] | undefined {
  return RESEARCH_INDUSTRIES.find((item) => item.id === filters.industry)
    ?? RESEARCH_INDUSTRIES.find((item) => item.id === researchNaicsCategory(filters.naics)?.industry);
}

export function businessSearchFilters(input: unknown): BusinessSearchFilters {
  if (!isRecord(input)) throw new WorkspaceError('Provide search filters.', 400);
  if (Object.keys(input).some((key) => !(key in EMPTY_BUSINESS_SEARCH))) throw new WorkspaceError('An unsupported business filter was supplied.', 400);
  const filters = { ...EMPTY_BUSINESS_SEARCH };
  for (const key of Object.keys(filters) as Array<keyof BusinessSearchFilters>) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f]/.test(value)) throw new WorkspaceError('Search fields must be text of up to 120 characters.', 400);
    filters[key] = value.trim();
  }
  filters.state = filters.state.toUpperCase();
  if (filters.state && !RESEARCH_US_STATES.includes(filters.state)) throw new WorkspaceError('Choose a valid U.S. state or territory.', 400);
  if (filters.industry && !RESEARCH_INDUSTRIES.some((item) => item.id === filters.industry)) throw new WorkspaceError('Choose a supported industry.', 400);
  if (filters.naics && !RESEARCH_NAICS.some((item) => item.code === filters.naics)) throw new WorkspaceError('Choose an official 2022 NAICS code.', 400);
  const mapped = RESEARCH_INDUSTRIES.find((item) => item.id === researchNaicsCategory(filters.naics)?.industry);
  if (mapped && filters.industry && mapped.id !== filters.industry) throw new WorkspaceError('Industry and NAICS category must agree.', 400);
  if (filters.zip && !/^\d{5}$/.test(filters.zip)) throw new WorkspaceError('Use a five-digit ZIP code.', 400);
  if (filters.place_id) {
    const place = researchPlace(filters.state, filters.place_id);
    if (filters.city && filters.city !== place.name) throw new WorkspaceError('The selected city and state do not agree.', 400);
    filters.city = place.name;
  }
  if (filters.radius_miles && (!['5', '10', '25', '50'].includes(filters.radius_miles) || !filters.place_id)) throw new WorkspaceError('Choose a city and a supported search radius.', 400);
  if (filters.map_bounds) {
    const bounds = filters.map_bounds.split(',').map(Number), [south, west, north, east] = bounds;
    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || south < -90 || north > 90 || west < -180 || east > 180
      || south >= north || west >= east || north - south > 2 || east - west > 2) throw new WorkspaceError('Zoom in to a valid map area before searching.', 400);
    if (filters.radius_miles || filters.zip) throw new WorkspaceError('Use either a map area or a ZIP/radius filter.', 400);
  }
  if (filters.benefits && !['pension', 'welfare', 'any'].includes(filters.benefits)) throw new WorkspaceError('Choose a supported employer-plan filter.', 400);
  if (filters.contact && !['phone', 'email', 'website', 'any'].includes(filters.contact)) throw new WorkspaceError('Choose a supported business-contact filter.', 400);
  for (const [minimum, maximum, label] of [['min_power_units', 'max_power_units', 'fleet size'], ['min_revenue', 'max_revenue', 'reported revenue'],
    ['min_participants', 'max_participants', 'plan participants']] as const) {
    for (const key of [minimum, maximum]) {
      if (filters[key] && (!/^\d{1,12}$/.test(filters[key]) || !Number.isSafeInteger(Number(filters[key])))) throw new WorkspaceError(`Enter a nonnegative whole number for ${label}.`, 400);
    }
    if (filters[minimum] && filters[maximum] && Number(filters[minimum]) > Number(filters[maximum])) throw new WorkspaceError(`Minimum ${label} cannot exceed maximum.`, 400);
  }
  if ((filters.min_power_units || filters.max_power_units) && filters.industry !== 'trucking') throw new WorkspaceError('Fleet-size filters require DOT-registered fleets.', 400);
  if ((filters.min_revenue || filters.max_revenue) && filters.industry !== 'nonprofit') throw new WorkspaceError('Reported-revenue filters currently require nonprofit filings.', 400);
  if ((filters.benefits || filters.min_participants || filters.max_participants) && (filters.map_bounds || filters.industry === 'trucking' || filters.industry === 'nonprofit')) {
    throw new WorkspaceError('Employer-plan filters require an industry/NAICS and state/city, without a map-area or fleet/nonprofit filter.', 400);
  }
  return filters;
}

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
export function researchIdentity(observation: BusinessObservation): string {
  const v = observation.values;
  // Only exact business name, numbered street and ZIP corroborate cross-source identity.
  const key = v.street && /^\d+\s/.test(v.street) && v.zip && /^\d{5}/.test(v.zip)
    ? `address:${normalize(v.name)}:${normalize(v.street)}:${v.zip.slice(0, 5)}`
    : `${observation.source}:${observation.record_id}`;
  return createHash('sha256').update(key).digest('hex');
}
export function researchInsights(observations: BusinessObservation[]): ResearchInsight[] {
  const facts: ReturnType<typeof researchInsights> = [];
  const references = observations.map((item) => `${item.source}:${item.record_id}`);
  const phones = [...new Set(observations.map((item) => item.values.phone?.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')).filter(Boolean))];
  if (phones.length > 1) facts.push({ kind: 'conflict', text: 'Sources report different business phones. Verify the current contact route.', sources: references });
  if (!observations.some((item) => item.values.phone || item.values.email)) facts.push({ kind: 'question', text: 'Research a current business contact before outreach.', sources: references });
  const fleet = observations.find((item) => item.values.power_units !== null);
  if (fleet) facts.push({ kind: 'fact', text: `Reported power units: ${fleet.values.power_units}. This is not an employee count or proof of a current policy.`, sources: [`${fleet.source}:${fleet.record_id}`] });
  facts.push({ kind: 'question', text: 'Confirm current coverage, renewal timing and the person responsible for insurance. Public registration does not establish these facts.', sources: references });
  return facts;
}
export function researchMatchingFacts(observations: BusinessObservation[], now = new Date()): {
  facts: OpportunityProfile['facts']; current: BusinessField[];
} {
  const facts: OpportunityProfile['facts'] = {}, current: BusinessField[] = [];
  const recent = (day: string | null): boolean => {
    if (!validEvidenceDate(day)) return false;
    const age = now.getTime() - Date.parse(`${day}T00:00:00Z`);
    return age >= 0 && age <= 90 * 86400000;
  };
  for (const field of ['state', 'power_units', 'industry', 'class_code'] as const) {
    const values = [...new Set(observations.filter((item) => item.values.classification === 'reported'
      && recent(field === 'power_units' ? item.values.registration_reported_on : item.source_as_of))
      .map((item) => field === 'class_code' ? item.values.naics : item.values[field]).filter((value) => value !== null && value !== ''))];
    if (values.length === 1) { facts[field] = String(values[0]); current.push(field); }
  }
  return { facts, current };
}
