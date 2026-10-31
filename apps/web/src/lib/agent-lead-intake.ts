import type { AssetDetails, AssetKind } from '@crm/shared';
import { isRecord } from './workspace-validation';

export type IntakeKind = 'personal' | 'commercial';

export interface Option {
  value: string;
  label: string;
}

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD',
  'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
] as const;

export const LEAD_SOURCES: ReadonlyArray<Option & { warm: boolean }> = [
  { value: 'Phone Call', label: 'Inbound phone call', warm: true },
  { value: 'referral', label: 'Referral', warm: true },
  { value: 'Walk-in', label: 'Walk-in', warm: true },
  { value: 'website', label: 'Website / email inquiry', warm: true },
  { value: 'Facebook', label: 'Facebook / social', warm: true },
  { value: 'Google', label: 'Google', warm: true },
  { value: 'Networking', label: 'Networking event', warm: false },
  { value: 'cold_outreach', label: 'Cold outreach', warm: false },
];

export const CONTACT_METHODS: readonly Option[] = [
  { value: 'call', label: 'Phone call' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
];

export const CARRIERS = [
  'Not currently insured', 'Allstate', 'American Family', 'Travelers', 'Farmers', 'GEICO', 'Hartford', 'Liberty Mutual', 'Nationwide',
  'Progressive', 'Safeco', 'State Farm', 'USAA', 'Hiscox', 'NEXT', 'biBERK', 'Other',
] as const;

export const PERSONAL_COVERAGES: readonly Option[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'home', label: 'Homeowners' },
  { value: 'renters', label: 'Renters' },
  { value: 'condo', label: 'Condo' },
  { value: 'landlord', label: 'Landlord / rental dwelling' },
  { value: 'umbrella', label: 'Personal umbrella' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'rv_boat', label: 'RV / boat' },
  { value: 'life', label: 'Life' },
];

export const COMMERCIAL_COVERAGES: readonly Option[] = [
  { value: 'gl', label: 'General liability' },
  { value: 'bop', label: 'Business owners policy (BOP)' },
  { value: 'wc', label: "Workers' compensation" },
  { value: 'commercial_auto', label: 'Commercial auto' },
  { value: 'property', label: 'Commercial property' },
  { value: 'professional', label: 'Professional / E&O' },
  { value: 'cyber', label: 'Cyber' },
  { value: 'umbrella', label: 'Commercial umbrella' },
  { value: 'inland_marine', label: 'Tools & equipment (inland marine)' },
  { value: 'liquor', label: 'Liquor liability' },
  { value: 'bonds', label: 'Bonds' },
];

export const MARITAL_STATUSES = ['Single', 'Married', 'Domestic partner', 'Divorced', 'Widowed'] as const;
export const DRIVER_RELATIONSHIPS = ['Self', 'Spouse', 'Child', 'Parent', 'Other household member'] as const;
export const VEHICLE_USES = ['Commute', 'Pleasure', 'Business', 'Rideshare / delivery'] as const;
export const OWNERSHIP = ['Owned', 'Financed', 'Leased'] as const;
export const PROPERTY_USES = ['Primary home', 'Secondary home', 'Rental', 'Vacant'] as const;
export const ROOF_TYPES = ['Asphalt shingle', 'Tile', 'Metal', 'Flat / foam', 'Other'] as const;
export const CONSTRUCTION_TYPES = ['Frame', 'Masonry / block', 'Stucco over frame', 'Manufactured', 'Other'] as const;
export const PRIOR_LIMITS = ['State minimum', '25/50/25', '50/100/50', '100/300/100', '250/500/250', '500/500/500', 'Not sure'] as const;
export const UMBRELLA_LIMITS = ['$1M', '$2M', '$3M', '$5M'] as const;
export const ENTITY_TYPES = ['LLC', 'Sole proprietor', 'Partnership', 'S-Corp', 'C-Corp', 'Nonprofit'] as const;
export const CONTACT_TITLES = ['Owner', 'Partner', 'Office manager', 'Operations manager', 'CFO / bookkeeper', 'Other'] as const;
export const COMMERCIAL_VEHICLE_TYPES = ['Car / SUV', 'Pickup', 'Cargo van', 'Box truck', 'Tractor', 'Trailer', 'Other'] as const;

export interface IndustryQuestion {
  key: string;
  label: string;
  type: 'yesno' | 'number' | 'text' | 'select';
  options?: readonly string[];
}

export interface IndustryGroup {
  label: string;
  businessTypes: ReadonlyArray<{ label: string; naics: string }>;
  suggestedCoverages: readonly string[];
  questions: readonly IndustryQuestion[];
}

export const INDUSTRY_GROUPS: Record<string, IndustryGroup> = {
  construction: {
    label: 'Construction & trades',
    businessTypes: [
      { label: 'General contractor', naics: '236220' },
      { label: 'Residential remodeler', naics: '236118' },
      { label: 'Roofing contractor', naics: '238160' },
      { label: 'Electrical contractor', naics: '238210' },
      { label: 'Plumbing / HVAC contractor', naics: '238220' },
      { label: 'Painting contractor', naics: '238320' },
      { label: 'Flooring contractor', naics: '238330' },
      { label: 'Concrete contractor', naics: '238110' },
      { label: 'Handyman', naics: '236118' },
    ],
    suggestedCoverages: ['gl', 'wc', 'commercial_auto', 'inland_marine'],
    questions: [
      { key: 'max_height_feet', label: 'Maximum working height (feet)', type: 'number' },
      { key: 'residential_percentage', label: 'Residential work (%)', type: 'number' },
      { key: 'performs_roofing', label: 'Performs any roofing work?', type: 'yesno' },
      { key: 'performs_structural', label: 'Performs structural work?', type: 'yesno' },
      { key: 'uses_subcontractors', label: 'Hires subcontractors?', type: 'yesno' },
      { key: 'annual_sub_cost', label: 'Annual subcontractor cost ($)', type: 'number' },
    ],
  },
  trucking: {
    label: 'Trucking & transportation',
    businessTypes: [
      { label: 'For-hire trucking', naics: '484121' },
      { label: 'Local freight / hotshot', naics: '484110' },
      { label: 'Courier / last-mile delivery', naics: '492110' },
      { label: 'Towing', naics: '488410' },
      { label: 'Moving company', naics: '484210' },
    ],
    suggestedCoverages: ['commercial_auto', 'gl', 'inland_marine', 'wc'],
    questions: [
      { key: 'dot_number', label: 'USDOT number', type: 'text' },
      { key: 'power_units', label: 'Power units', type: 'number' },
      { key: 'radius', label: 'Operating radius', type: 'select', options: ['Local (under 50 mi)', 'Intermediate (50-200 mi)', 'Long haul (200+ mi)'] },
      { key: 'cargo_type', label: 'Primary cargo', type: 'text' },
    ],
  },
  food_hospitality: {
    label: 'Restaurants & hospitality',
    businessTypes: [
      { label: 'Full-service restaurant', naics: '722511' },
      { label: 'Quick-service restaurant', naics: '722513' },
      { label: 'Bar / tavern', naics: '722410' },
      { label: 'Food truck', naics: '722330' },
      { label: 'Caterer', naics: '722320' },
      { label: 'Hotel / motel', naics: '721110' },
    ],
    suggestedCoverages: ['bop', 'wc', 'liquor', 'property'],
    questions: [
      { key: 'alcohol_sales_percentage', label: 'Alcohol share of sales (%)', type: 'number' },
      { key: 'seating_capacity', label: 'Seating capacity', type: 'number' },
      { key: 'has_delivery', label: 'Offers delivery?', type: 'yesno' },
      { key: 'has_cooking_hood', label: 'Commercial cooking with hood suppression?', type: 'yesno' },
    ],
  },
  retail: {
    label: 'Retail & wholesale',
    businessTypes: [
      { label: 'Clothing / boutique', naics: '458110' },
      { label: 'Convenience store', naics: '445131' },
      { label: 'Grocery', naics: '445110' },
      { label: 'E-commerce', naics: '455219' },
      { label: 'Wholesale distributor', naics: '423990' },
    ],
    suggestedCoverages: ['bop', 'property', 'gl', 'cyber'],
    questions: [
      { key: 'public_sqft', label: 'Customer-facing square feet', type: 'number' },
      { key: 'sells_own_products', label: 'Sells products they manufacture or label?', type: 'yesno' },
      { key: 'online_sales_percentage', label: 'Online sales (%)', type: 'number' },
    ],
  },
  professional: {
    label: 'Professional & tech services',
    businessTypes: [
      { label: 'Consultant', naics: '541611' },
      { label: 'Accountant / bookkeeper', naics: '541219' },
      { label: 'IT / software services', naics: '541511' },
      { label: 'Marketing agency', naics: '541810' },
      { label: 'Real estate agent / broker', naics: '531210' },
      { label: 'Architect / engineer', naics: '541330' },
    ],
    suggestedCoverages: ['professional', 'gl', 'cyber', 'bop'],
    questions: [
      { key: 'handles_sensitive_data', label: 'Stores client personal or payment data?', type: 'yesno' },
      { key: 'has_written_contracts', label: 'Uses written client contracts?', type: 'yesno' },
      { key: 'largest_contract', label: 'Largest single contract ($)', type: 'number' },
    ],
  },
  healthcare: {
    label: 'Healthcare & wellness',
    businessTypes: [
      { label: 'Medical / dental office', naics: '621111' },
      { label: 'Home health care', naics: '621610' },
      { label: 'Fitness studio / gym', naics: '713940' },
      { label: 'Salon / spa', naics: '812112' },
      { label: 'Massage therapy', naics: '812199' },
    ],
    suggestedCoverages: ['professional', 'gl', 'bop', 'wc'],
    questions: [
      { key: 'licensed_professionals', label: 'Licensed practitioners', type: 'number' },
      { key: 'performs_procedures', label: 'Performs invasive or hands-on procedures?', type: 'yesno' },
    ],
  },
  property_services: {
    label: 'Cleaning, landscaping & property services',
    businessTypes: [
      { label: 'Janitorial / commercial cleaning', naics: '561720' },
      { label: 'Residential cleaning', naics: '561720' },
      { label: 'Landscaping', naics: '561730' },
      { label: 'Pest control', naics: '561710' },
      { label: 'Pool service', naics: '561790' },
      { label: 'Property manager', naics: '531311' },
    ],
    suggestedCoverages: ['gl', 'wc', 'commercial_auto', 'inland_marine', 'bonds'],
    questions: [
      { key: 'residential_percentage', label: 'Residential work (%)', type: 'number' },
      { key: 'uses_chemicals', label: 'Applies pesticides or chemicals?', type: 'yesno' },
      { key: 'uses_subcontractors', label: 'Hires subcontractors?', type: 'yesno' },
    ],
  },
  auto_services: {
    label: 'Auto services',
    businessTypes: [
      { label: 'Auto repair shop', naics: '811111' },
      { label: 'Auto body / collision', naics: '811121' },
      { label: 'Car dealership', naics: '441120' },
      { label: 'Car wash / detailing', naics: '811192' },
    ],
    suggestedCoverages: ['gl', 'property', 'wc', 'commercial_auto'],
    questions: [
      { key: 'customer_vehicles_on_site', label: 'Typical customer vehicles on site', type: 'number' },
      { key: 'test_drives', label: 'Employees drive customer vehicles?', type: 'yesno' },
    ],
  },
  manufacturing: {
    label: 'Manufacturing',
    businessTypes: [
      { label: 'Metal fabrication', naics: '332312' },
      { label: 'Food manufacturing', naics: '311999' },
      { label: 'Cabinet / woodworking', naics: '337110' },
      { label: 'Printing', naics: '323111' },
    ],
    suggestedCoverages: ['gl', 'property', 'wc', 'commercial_auto'],
    questions: [
      { key: 'products_sold_where', label: 'Where are products sold?', type: 'text' },
      { key: 'has_product_recalls', label: 'Any product recalls?', type: 'yesno' },
    ],
  },
  nonprofit: {
    label: 'Nonprofit & religious',
    businessTypes: [
      { label: 'Church / religious organization', naics: '813110' },
      { label: 'Charity / social services', naics: '813219' },
      { label: 'Youth or community organization', naics: '813410' },
    ],
    suggestedCoverages: ['gl', 'property', 'professional', 'wc'],
    questions: [
      { key: 'volunteer_count', label: 'Volunteers', type: 'number' },
      { key: 'works_with_minors', label: 'Works with minors?', type: 'yesno' },
    ],
  },
  other: {
    label: 'Other',
    businessTypes: [],
    suggestedCoverages: ['gl'],
    questions: [],
  },
};

export interface DriverInput { name: string; dob: string; relationship: string; license_state: string }
export interface VehicleInput { year: string; make: string; model: string; vin: string; use: string; ownership: string; vehicle_type: string }
export interface PropertyInput { address: string; use: string; year_built: string; roof: string; construction: string; has_pool: string; dog_breed: string }

export interface ContactInput {
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  preferred_contact: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export interface CurrentInsuranceInput {
  carrier: string;
  expiration: string;
  premium: string;
}

export interface PersonalIntake {
  kind: 'personal';
  source: string;
  contact: ContactInput;
  dob: string;
  marital_status: string;
  occupation: string;
  coverages: string[];
  current: CurrentInsuranceInput;
  prior_limits: string;
  umbrella_limit: string;
  drivers: DriverInput[];
  vehicles: VehicleInput[];
  properties: PropertyInput[];
  notes: string;
}

export interface CommercialIntake {
  kind: 'commercial';
  source: string;
  contact: ContactInput & { title: string };
  business: {
    legal_name: string;
    dba: string;
    entity_type: string;
    fein: string;
    years_in_business: string;
    website: string;
    industry_group: string;
    business_type: string;
    naics: string;
    description: string;
    employees: string;
    annual_revenue: string;
    annual_payroll: string;
  };
  coverages: string[];
  current: CurrentInsuranceInput;
  industry_answers: Record<string, string>;
  vehicles: VehicleInput[];
  notes: string;
}

export type AgentIntake = PersonalIntake | CommercialIntake;

export interface IntakeField { label: string; value: string }
export interface IntakeSection { title: string; fields: IntakeField[] }

export interface PreparedAsset {
  title: string;
  asset_type: AssetKind;
  details: AssetDetails;
}

export interface PreparedLead {
  lead: {
    full_name: string;
    business: string | null;
    phone: string;
    email: string | null;
    address: string | null;
    state: string | null;
    zip: string | null;
    industry: string | null;
    category: string | null;
    website: string | null;
    est_employees: string | null;
    est_revenue: string | null;
    line_of_business: IntakeKind;
    primary_coverage: string | null;
    source: string;
    status: 'new';
    form_payload: { business_name?: string; agent_intake: { version: 1; kind: IntakeKind; captured_at: string; captured_by: string; sections: IntakeSection[]; answers: AgentIntake } };
  };
  assets: PreparedAsset[];
  note: string | null;
  warm: boolean;
}

const MAX_TEXT = 500;
const MAX_NOTES = 20000;

class IntakeError extends Error {}

function str(record: Record<string, unknown>, key: string, label: string, options: { required?: boolean; max?: number } = {}): string {
  const raw = record[key];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw new IntakeError(`${label} must be text.`);
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (options.required && !value) throw new IntakeError(`${label} is required.`);
  if (value.length > (options.max ?? MAX_TEXT)) throw new IntakeError(`${label} is too long.`);
  return value;
}

function oneOf(value: string, allowed: readonly string[], label: string): string {
  if (value && !allowed.includes(value)) throw new IntakeError(`Choose a valid ${label.toLowerCase()}.`);
  return value;
}

function obj(value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new IntakeError(`${label} must be an object.`);
  return value;
}

function list(value: unknown, label: string, max: number): Record<string, unknown>[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) throw new IntakeError(`${label} must be a list.`);
  if (value.length > max) throw new IntakeError(`Add at most ${max} ${label.toLowerCase()}.`);
  return value as Record<string, unknown>[];
}

export function phoneDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

function isoDate(value: string, label: string, { past = false } = {}): string {
  if (!value) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IntakeError(`${label} must be a valid date.`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new IntakeError(`${label} must be a valid date.`);
  if (past && (year < 1900 || date.getTime() > Date.now())) throw new IntakeError(`${label} must be in the past.`);
  return value;
}

function wholeNumber(value: string, label: string): string {
  if (!value) return '';
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new IntakeError(`${label} must be a number.`);
  return cleaned;
}

function coverageList(value: unknown, allowed: readonly Option[]): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new IntakeError('Coverages must be a list.');
  const valid = new Set(allowed.map((option) => option.value));
  const unique = [...new Set(value as string[])];
  if (unique.some((item) => !valid.has(item))) throw new IntakeError('Choose valid coverages.');
  if (!unique.length) throw new IntakeError('Choose at least one coverage the prospect is interested in.');
  return unique;
}

function contact(value: unknown): ContactInput {
  const record = obj(value, 'Contact');
  const email = str(record, 'email', 'Email', { max: 254 }).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IntakeError('Enter a valid email address.');
  const phone = str(record, 'phone', 'Phone', { required: true, max: 40 });
  if (phoneDigits(phone).length !== 10) throw new IntakeError('Enter a 10-digit phone number.');
  const zip = str(record, 'zip', 'ZIP code', { max: 10 });
  if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) throw new IntakeError('Enter a valid ZIP code.');
  return {
    first_name: str(record, 'first_name', 'First name', { required: true, max: 100 }),
    last_name: str(record, 'last_name', 'Last name', { required: true, max: 100 }),
    phone,
    email,
    preferred_contact: oneOf(str(record, 'preferred_contact', 'Preferred contact'), CONTACT_METHODS.map((option) => option.value), 'Preferred contact'),
    street: str(record, 'street', 'Street address', { max: 200 }),
    city: str(record, 'city', 'City', { max: 100 }),
    state: oneOf(str(record, 'state', 'State').toUpperCase(), US_STATES, 'State'),
    zip,
  };
}

function current(value: unknown): CurrentInsuranceInput {
  const record = obj(value, 'Current insurance');
  return {
    carrier: str(record, 'carrier', 'Current carrier', { max: 100 }),
    expiration: isoDate(str(record, 'expiration', 'Current policy expiration'), 'Current policy expiration'),
    premium: wholeNumber(str(record, 'premium', 'Current premium'), 'Current premium'),
  };
}

function vehicles(value: unknown, commercial: boolean): VehicleInput[] {
  return list(value, 'Vehicles', 50).map((record, index) => {
    const label = `Vehicle ${index + 1}`;
    const year = str(record, 'year', `${label} year`, { max: 4 });
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > new Date().getUTCFullYear() + 2)) {
      throw new IntakeError(`${label}: enter a valid four-digit year.`);
    }
    const vin = str(record, 'vin', `${label} VIN`, { max: 17 }).toUpperCase();
    if (vin && !(year && Number(year) < 1981 ? /^[A-Z0-9]{5,17}$/ : /^[A-HJ-NPR-Z0-9]{17}$/).test(vin)) {
      throw new IntakeError(`${label}: a modern VIN has 17 letters or digits (no I, O, or Q). Leave it empty if unknown.`);
    }
    const vehicle: VehicleInput = {
      year,
      make: str(record, 'make', `${label} make`, { max: 60 }),
      model: str(record, 'model', `${label} model`, { max: 60 }),
      vin,
      use: oneOf(str(record, 'use', `${label} use`), VEHICLE_USES, `${label} use`),
      ownership: oneOf(str(record, 'ownership', `${label} ownership`), OWNERSHIP, `${label} ownership`),
      vehicle_type: oneOf(str(record, 'vehicle_type', `${label} type`), commercial ? COMMERCIAL_VEHICLE_TYPES : [], `${label} type`),
    };
    if (!vehicle.year && !vehicle.make && !vehicle.model && !vehicle.vin) throw new IntakeError(`${label}: enter a year, make, model, or VIN, or remove it.`);
    return vehicle;
  });
}

function validatePersonal(record: Record<string, unknown>, source: string): PersonalIntake {
  const intakeContact = contact(record.contact);
  const coverages = coverageList(record.coverages, PERSONAL_COVERAGES);
  const drivers = list(record.drivers, 'Drivers', 20).map((driver, index) => {
    const label = `Driver ${index + 1}`;
    const value: DriverInput = {
      name: str(driver, 'name', `${label} name`, { required: true, max: 120 }),
      dob: isoDate(str(driver, 'dob', `${label} date of birth`), `${label} date of birth`, { past: true }),
      relationship: oneOf(str(driver, 'relationship', `${label} relationship`), DRIVER_RELATIONSHIPS, `${label} relationship`),
      license_state: oneOf(str(driver, 'license_state', `${label} license state`).toUpperCase(), US_STATES, `${label} license state`),
    };
    return value;
  });
  const properties = list(record.properties, 'Properties', 20).map((property, index) => {
    const label = `Property ${index + 1}`;
    const yearBuilt = str(property, 'year_built', `${label} year built`, { max: 4 });
    if (yearBuilt && (!/^\d{4}$/.test(yearBuilt) || Number(yearBuilt) < 1700 || Number(yearBuilt) > new Date().getUTCFullYear() + 1)) {
      throw new IntakeError(`${label}: enter a valid year built.`);
    }
    const value: PropertyInput = {
      address: str(property, 'address', `${label} address`, { required: true, max: 300 }),
      use: oneOf(str(property, 'use', `${label} use`), PROPERTY_USES, `${label} use`),
      year_built: yearBuilt,
      roof: oneOf(str(property, 'roof', `${label} roof`), ROOF_TYPES, `${label} roof`),
      construction: oneOf(str(property, 'construction', `${label} construction`), CONSTRUCTION_TYPES, `${label} construction`),
      has_pool: oneOf(str(property, 'has_pool', `${label} pool`), ['yes', 'no'], `${label} pool`),
      dog_breed: str(property, 'dog_breed', `${label} dog breed`, { max: 100 }),
    };
    return value;
  });
  return {
    kind: 'personal',
    source,
    contact: intakeContact,
    dob: isoDate(str(record, 'dob', 'Date of birth'), 'Date of birth', { past: true }),
    marital_status: oneOf(str(record, 'marital_status', 'Marital status'), MARITAL_STATUSES, 'Marital status'),
    occupation: str(record, 'occupation', 'Occupation', { max: 120 }),
    coverages,
    current: current(record.current),
    prior_limits: oneOf(str(record, 'prior_limits', 'Prior liability limits'), PRIOR_LIMITS, 'Prior liability limits'),
    umbrella_limit: oneOf(str(record, 'umbrella_limit', 'Umbrella limit'), UMBRELLA_LIMITS, 'Umbrella limit'),
    drivers,
    vehicles: vehicles(record.vehicles, false),
    properties,
    notes: str(record, 'notes', 'Call notes', { max: MAX_NOTES }),
  };
}

function validateCommercial(record: Record<string, unknown>, source: string): CommercialIntake {
  const contactRecord = obj(record.contact, 'Contact');
  const intakeContact = { ...contact(contactRecord), title: oneOf(str(contactRecord, 'title', 'Contact title'), CONTACT_TITLES, 'Contact title') };
  const business = obj(record.business, 'Business');
  const industryGroup = str(business, 'industry_group', 'Industry', { required: true, max: 60 });
  const group = INDUSTRY_GROUPS[industryGroup];
  if (!group || !Object.hasOwn(INDUSTRY_GROUPS, industryGroup)) throw new IntakeError('Choose a valid industry.');
  const fein = str(business, 'fein', 'FEIN', { max: 12 });
  if (fein && fein.replace(/\D/g, '').length !== 9) throw new IntakeError('FEIN must be 9 digits.');
  const naics = str(business, 'naics', 'NAICS code', { max: 6 });
  if (naics && !/^\d{2,6}$/.test(naics)) throw new IntakeError('NAICS code must be 2 to 6 digits.');
  const years = wholeNumber(str(business, 'years_in_business', 'Years in business', { max: 4 }), 'Years in business');
  const answersRecord = obj(record.industry_answers, 'Industry answers');
  const allowedQuestions = new Map(group.questions.map((question) => [question.key, question]));
  const industryAnswers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(answersRecord)) {
    const question = allowedQuestions.get(key);
    if (!question) throw new IntakeError(`${key} is not a question for this industry.`);
    if (typeof raw !== 'string') throw new IntakeError(`${question.label} must be text.`);
    let answer = raw.trim();
    if (!answer) continue;
    if (answer.length > MAX_TEXT) throw new IntakeError(`${question.label} is too long.`);
    if (question.type === 'yesno') answer = oneOf(answer, ['yes', 'no'], question.label);
    if (question.type === 'number') answer = wholeNumber(answer, question.label);
    if (question.type === 'select') answer = oneOf(answer, question.options ?? [], question.label);
    industryAnswers[key] = answer;
  }
  const website = str(business, 'website', 'Website', { max: 200 });
  return {
    kind: 'commercial',
    source,
    contact: intakeContact,
    business: {
      legal_name: str(business, 'legal_name', 'Business legal name', { required: true, max: 200 }),
      dba: str(business, 'dba', 'DBA', { max: 200 }),
      entity_type: oneOf(str(business, 'entity_type', 'Entity type'), ENTITY_TYPES, 'Entity type'),
      fein: fein ? fein.replace(/\D/g, '').replace(/^(\d{2})/, '$1-') : '',
      years_in_business: years,
      website: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
      industry_group: industryGroup,
      business_type: str(business, 'business_type', 'Business type', { required: true, max: 120 }),
      naics,
      description: str(business, 'description', 'What the business does', { max: 2000 }),
      employees: wholeNumber(str(business, 'employees', 'Employees'), 'Employees'),
      annual_revenue: wholeNumber(str(business, 'annual_revenue', 'Annual revenue'), 'Annual revenue'),
      annual_payroll: wholeNumber(str(business, 'annual_payroll', 'Annual payroll'), 'Annual payroll'),
    },
    coverages: coverageList(record.coverages, COMMERCIAL_COVERAGES),
    current: current(record.current),
    industry_answers: industryAnswers,
    vehicles: vehicles(record.vehicles, true),
    notes: str(record, 'notes', 'Call notes', { max: MAX_NOTES }),
  };
}

export function validateAgentIntake(value: unknown): AgentIntake | string {
  try {
    if (!isRecord(value)) throw new IntakeError('Intake details are required.');
    const source = str(value, 'source', 'Lead source', { required: true, max: 60 });
    oneOf(source, LEAD_SOURCES.map((option) => option.value), 'Lead source');
    if (value.kind === 'personal') return validatePersonal(value, source);
    if (value.kind === 'commercial') return validateCommercial(value, source);
    throw new IntakeError('Choose personal or commercial lines.');
  } catch (error) {
    if (error instanceof IntakeError) return error.message;
    throw error;
  }
}

function labelOf(options: readonly Option[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

function money(value: string): string {
  if (!value) return '';
  return `$${Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function yesNo(value: string): string {
  return value === 'yes' ? 'Yes' : value === 'no' ? 'No' : value;
}

function fullAddress(input: ContactInput): string {
  const cityLine = [input.city, [input.state, input.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [input.street, cityLine].filter(Boolean).join(', ');
}

function fields(entries: Array<[string, string]>): IntakeField[] {
  return entries.filter(([, value]) => value.trim()).map(([label, value]) => ({ label, value }));
}

function vehicleTitle(vehicle: VehicleInput, index: number): string {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || `Vehicle ${index + 1}`;
}

function vehicleSections(list: VehicleInput[]): IntakeSection[] {
  return list.map((vehicle, index) => ({
    title: `Vehicle ${index + 1}: ${vehicleTitle(vehicle, index)}`,
    fields: fields([['Type', vehicle.vehicle_type], ['VIN', vehicle.vin], ['Use', vehicle.use], ['Ownership', vehicle.ownership]]),
  }));
}

function currentFields(input: CurrentInsuranceInput): Array<[string, string]> {
  return [['Current carrier', input.carrier], ['Current policy expires', input.expiration], ['Current premium', money(input.premium)]];
}

export function intakeSections(intake: AgentIntake): IntakeSection[] {
  const sourceLabel = LEAD_SOURCES.find((option) => option.value === intake.source)?.label ?? intake.source;
  const contactFields: Array<[string, string]> = [
    ['Name', `${intake.contact.first_name} ${intake.contact.last_name}`],
    ...(intake.kind === 'commercial' ? [['Title', intake.contact.title] as [string, string]] : []),
    ['Phone', intake.contact.phone],
    ['Email', intake.contact.email],
    ['Preferred contact', labelOf(CONTACT_METHODS, intake.contact.preferred_contact)],
    [intake.kind === 'commercial' ? 'Business address' : 'Home address', fullAddress(intake.contact)],
    ['Lead source', sourceLabel],
  ];
  const sections: IntakeSection[] = [];
  if (intake.kind === 'personal') {
    contactFields.splice(1, 0, ['Date of birth', intake.dob], ['Marital status', intake.marital_status], ['Occupation', intake.occupation]);
    sections.push({ title: 'Applicant', fields: fields(contactFields) });
    sections.push({
      title: 'Coverage Requested',
      fields: fields([
        ['Interested in', intake.coverages.map((value) => labelOf(PERSONAL_COVERAGES, value)).join(', ')],
        ...currentFields(intake.current),
        ['Prior auto liability limits', intake.prior_limits],
        ['Umbrella limit wanted', intake.umbrella_limit],
      ]),
    });
    intake.drivers.forEach((driver, index) => sections.push({
      title: `Driver ${index + 1}: ${driver.name}`,
      fields: fields([['Relationship', driver.relationship], ['Date of birth', driver.dob], ['License state', driver.license_state]]),
    }));
    sections.push(...vehicleSections(intake.vehicles));
    intake.properties.forEach((property, index) => sections.push({
      title: `Property ${index + 1}: ${property.address}`,
      fields: fields([
        ['Use', property.use], ['Year built', property.year_built], ['Roof', property.roof], ['Construction', property.construction],
        ['Pool', yesNo(property.has_pool)], ['Dog breed', property.dog_breed],
      ]),
    }));
  } else {
    const group = INDUSTRY_GROUPS[intake.business.industry_group];
    sections.push({
      title: 'Business',
      fields: fields([
        ['Legal name', intake.business.legal_name], ['DBA', intake.business.dba], ['Business type', intake.business.business_type],
        ['Industry', group.label], ['What they do', intake.business.description], ['NAICS', intake.business.naics],
        ['Entity type', intake.business.entity_type], ['FEIN', intake.business.fein], ['Years in business', intake.business.years_in_business],
        ['Employees', intake.business.employees], ['Annual revenue', money(intake.business.annual_revenue)],
        ['Annual payroll', money(intake.business.annual_payroll)], ['Website', intake.business.website],
      ]),
    });
    sections.push({ title: 'Primary Contact', fields: fields(contactFields) });
    sections.push({
      title: 'Coverage Requested',
      fields: fields([['Interested in', intake.coverages.map((value) => labelOf(COMMERCIAL_COVERAGES, value)).join(', ')], ...currentFields(intake.current)]),
    });
    const answers = group.questions
      .filter((question) => intake.industry_answers[question.key])
      .map((question): [string, string] => [question.label, question.type === 'yesno' ? yesNo(intake.industry_answers[question.key]) : intake.industry_answers[question.key]]);
    if (answers.length) sections.push({ title: `${group.label} Questions`, fields: fields(answers) });
    sections.push(...vehicleSections(intake.vehicles));
  }
  return sections.filter((section) => section.fields.length > 0 || section.title.includes(':'));
}

export function prepareLead(intake: AgentIntake, actor: string, now = new Date()): PreparedLead {
  const fullName = `${intake.contact.first_name} ${intake.contact.last_name}`;
  const address = fullAddress(intake.contact) || null;
  const assets: PreparedAsset[] = intake.vehicles.map((vehicle, index) => ({
    title: vehicleTitle(vehicle, index),
    asset_type: 'vehicle',
    details: Object.fromEntries(Object.entries({
      year: vehicle.year, make: vehicle.make, model: vehicle.model, vin: vehicle.vin, use: vehicle.use,
      ownership: vehicle.ownership, vehicle_type: vehicle.vehicle_type, address: address ?? '',
    }).filter(([, value]) => value)) as AssetDetails,
  }));
  let business: string | null = null;
  let industry: string | null = null;
  let category: string | null = null;
  let website: string | null = null;
  let employees: string | null = null;
  let revenue: string | null = null;
  if (intake.kind === 'personal') {
    for (const driver of intake.drivers) {
      assets.push({
        title: driver.name,
        asset_type: 'driver',
        details: Object.fromEntries(Object.entries({
          relationship: driver.relationship, license_state: driver.license_state, notes: driver.dob ? `Date of birth: ${driver.dob}` : '',
        }).filter(([, value]) => value)) as AssetDetails,
      });
    }
    for (const property of intake.properties) {
      const notes = [property.year_built && `Year built: ${property.year_built}`, property.has_pool && `Pool: ${yesNo(property.has_pool)}`, property.dog_breed && `Dog breed: ${property.dog_breed}`]
        .filter(Boolean).join('\n');
      assets.push({
        title: property.address,
        asset_type: 'property',
        details: Object.fromEntries(Object.entries({
          address: property.address, use: property.use, roof: property.roof, construction: property.construction, notes,
        }).filter(([, value]) => value)) as AssetDetails,
      });
    }
  } else {
    business = intake.business.dba ? `${intake.business.legal_name} (DBA ${intake.business.dba})` : intake.business.legal_name;
    industry = intake.business.business_type;
    category = INDUSTRY_GROUPS[intake.business.industry_group].label;
    website = intake.business.website || null;
    employees = intake.business.employees || null;
    revenue = intake.business.annual_revenue || null;
    if (address && intake.coverages.some((value) => value === 'property' || value === 'bop')) {
      assets.push({ title: `${intake.business.legal_name} location`, asset_type: 'property', details: { address, use: 'Business location' } });
    }
  }
  const coverageOptions = intake.kind === 'personal' ? PERSONAL_COVERAGES : COMMERCIAL_COVERAGES;
  return {
    lead: {
      full_name: fullName,
      business,
      phone: intake.contact.phone,
      email: intake.contact.email || null,
      address,
      state: intake.contact.state || null,
      zip: intake.contact.zip || null,
      industry,
      category,
      website,
      est_employees: employees,
      est_revenue: revenue,
      line_of_business: intake.kind,
      primary_coverage: labelOf(coverageOptions, intake.coverages[0]),
      source: intake.source,
      status: 'new',
      form_payload: {
        ...(intake.kind === 'commercial' ? { business_name: intake.business.legal_name } : {}),
        agent_intake: { version: 1, kind: intake.kind, captured_at: now.toISOString(), captured_by: actor, sections: intakeSections(intake), answers: intake },
      },
    },
    assets,
    note: intake.notes || null,
    warm: LEAD_SOURCES.find((option) => option.value === intake.source)?.warm ?? false,
  };
}

export interface ExistingRecord {
  type: 'lead' | 'account';
  id: string;
  full_name: string;
  business: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  state: string | null;
  zip: string | null;
  status: string | null;
  line_of_business: string | null;
  match: Array<'email' | 'phone'>;
}

/** Finds existing leads/accounts sharing the caller's email or phone, strongest (both) first. */
export function findExistingMatches(
  rows: Array<Omit<ExistingRecord, 'match'>>,
  email: string | null | undefined,
  phone: string | null | undefined,
  limit = 5,
): ExistingRecord[] {
  const wantedEmail = (email ?? '').trim().toLowerCase();
  const wantedPhone = phoneDigits(phone);
  const matches: ExistingRecord[] = [];
  for (const row of rows) {
    const match: Array<'email' | 'phone'> = [];
    if (wantedEmail && (row.email ?? '').trim().toLowerCase() === wantedEmail) match.push('email');
    if (wantedPhone.length === 10 && phoneDigits(row.phone) === wantedPhone) match.push('phone');
    if (match.length) matches.push({ ...row, match });
  }
  return matches.sort((a, b) => b.match.length - a.match.length || (a.type === b.type ? 0 : a.type === 'account' ? -1 : 1)).slice(0, limit);
}

export function readIntakeSections(payload: Record<string, unknown> | null | undefined): { kind: string; capturedAt: string | null; capturedBy: string | null; sections: IntakeSection[] } | null {
  const intake = payload && isRecord(payload.agent_intake) ? payload.agent_intake : null;
  if (!intake || !Array.isArray(intake.sections)) return null;
  const sections = intake.sections.flatMap((section): IntakeSection[] => {
    if (!isRecord(section) || typeof section.title !== 'string' || !Array.isArray(section.fields)) return [];
    const sectionFields = section.fields.flatMap((field): IntakeField[] =>
      isRecord(field) && typeof field.label === 'string' && typeof field.value === 'string' ? [{ label: field.label, value: field.value }] : []);
    return [{ title: section.title, fields: sectionFields }];
  });
  return {
    kind: typeof intake.kind === 'string' ? intake.kind : 'personal',
    capturedAt: typeof intake.captured_at === 'string' ? intake.captured_at : null,
    capturedBy: typeof intake.captured_by === 'string' ? intake.captured_by : null,
    sections,
  };
}
