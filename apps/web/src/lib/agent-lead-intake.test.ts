import { describe, expect, it } from 'vitest';
import {
  findExistingMatches,
  prepareLead,
  readIntakeSections,
  validateAgentIntake,
  type AgentIntake,
} from './agent-lead-intake';
import { validateAsset } from './workspace-validation';

const contact = {
  first_name: ' Maria ', last_name: 'Lopez', phone: '(602) 555-0142', email: 'Maria@Example.com',
  preferred_contact: '', street: '12 W Main St', city: 'Mesa', state: 'az', zip: '85201',
};

const personal = {
  kind: 'personal',
  source: 'referral',
  contact,
  dob: '1985-04-02',
  marital_status: 'Married',
  occupation: 'Nurse',
  coverages: ['auto', 'home'],
  current: { carrier: 'GEICO', expiration: '2026-12-01', premium: '$1,840' },
  prior_limits: '100/300/100',
  umbrella_limit: '',
  drivers: [{ name: 'Maria Lopez', dob: '1985-04-02', relationship: 'Self', license_state: 'AZ' }],
  vehicles: [{ year: '2021', make: 'Toyota', model: 'RAV4', vin: '', use: 'Commute', ownership: 'Financed', vehicle_type: '' }],
  properties: [{ address: '12 W Main St, Mesa, AZ 85201', use: 'Primary home', year_built: '1998', roof: 'Tile', construction: 'Frame', has_pool: 'yes', dog_breed: '' }],
  notes: 'Wants quotes before renewal.',
};

const commercial = {
  kind: 'commercial',
  source: 'cold_outreach',
  contact: { ...contact, title: 'Owner' },
  business: {
    legal_name: 'Desert Peak Roofing LLC', dba: 'Desert Peak', entity_type: 'LLC', fein: '861234567', years_in_business: '6',
    website: 'desertpeak.com', industry_group: 'construction', business_type: 'Roofing contractor', naics: '238160',
    description: 'Residential re-roofs', employees: '8', annual_revenue: '1,200,000', annual_payroll: '400000',
  },
  coverages: ['gl', 'wc', 'property'],
  current: { carrier: '', expiration: '', premium: '' },
  industry_answers: { performs_roofing: 'yes', max_height_feet: '30' },
  vehicles: [{ year: '2020', make: 'Ford', model: 'F-250', vin: '', use: 'Business', ownership: 'Owned', vehicle_type: 'Pickup' }],
  notes: '',
};

function valid(value: unknown): AgentIntake {
  const result = validateAgentIntake(value);
  if (typeof result === 'string') throw new Error(result);
  return result;
}

describe('validateAgentIntake', () => {
  it('normalizes a personal intake', () => {
    const intake = valid(personal);
    expect(intake.contact.first_name).toBe('Maria');
    expect(intake.contact.email).toBe('maria@example.com');
    expect(intake.contact.state).toBe('AZ');
    expect(intake.current.premium).toBe('1840');
  });

  it('rejects missing names, bad phone, bad VIN, and unknown coverages', () => {
    expect(validateAgentIntake({ ...personal, contact: { ...contact, last_name: '' } })).toBe('Last name is required.');
    expect(validateAgentIntake({ ...personal, contact: { ...contact, phone: '555' } })).toBe('Enter a 10-digit phone number.');
    expect(validateAgentIntake({ ...personal, vehicles: [{ ...personal.vehicles[0], vin: 'BAD' }] })).toMatch(/VIN/);
    expect(validateAgentIntake({ ...personal, coverages: ['flood_zone_x'] })).toBe('Choose valid coverages.');
    expect(validateAgentIntake({ ...personal, coverages: [] })).toMatch(/at least one coverage/);
    expect(validateAgentIntake({ ...personal, source: 'billboard' })).toBe('Choose a valid lead source.');
  });

  it('only accepts questions that belong to the chosen industry', () => {
    expect(validateAgentIntake({ ...commercial, industry_answers: { dot_number: '123' } })).toMatch(/not a question for this industry/);
    expect(validateAgentIntake({ ...commercial, business: { ...commercial.business, industry_group: '__proto__' } })).toBe('Choose a valid industry.');
    expect(validateAgentIntake({ ...commercial, business: { ...commercial.business, fein: '12' } })).toBe('FEIN must be 9 digits.');
  });
});

describe('prepareLead', () => {
  it('builds a personal lead with drivers, vehicles, and homes as valid assets', () => {
    const prepared = prepareLead(valid(personal), 'agent@shield.test', new Date('2026-05-01T16:00:00Z'));
    expect(prepared.lead).toMatchObject({
      full_name: 'Maria Lopez', line_of_business: 'personal', primary_coverage: 'Auto', industry: null, business: null,
      address: '12 W Main St, Mesa, AZ 85201', status: 'new',
    });
    expect(prepared.warm).toBe(true);
    expect(prepared.note).toBe('Wants quotes before renewal.');
    expect(prepared.assets.map((asset) => asset.asset_type).sort()).toEqual(['driver', 'property', 'vehicle']);
    for (const asset of prepared.assets) expect(validateAsset({ ...asset, source: 'client_reported' })).not.toBeTypeOf('string');
    expect(prepared.lead.form_payload.agent_intake.captured_by).toBe('agent@shield.test');
  });

  it('keeps the specific business type separate from commercial lines', () => {
    const prepared = prepareLead(valid(commercial), 'agent@shield.test');
    expect(prepared.lead).toMatchObject({
      full_name: 'Maria Lopez',
      business: 'Desert Peak Roofing LLC (DBA Desert Peak)',
      industry: 'Roofing contractor',
      category: 'Construction & trades',
      line_of_business: 'commercial',
      website: 'https://desertpeak.com',
    });
    expect(prepared.warm).toBe(false);
    expect(prepared.lead.form_payload.business_name).toBe('Desert Peak Roofing LLC');
    expect(prepared.assets.map((asset) => asset.asset_type)).toEqual(['vehicle', 'property']);
    for (const asset of prepared.assets) expect(validateAsset({ ...asset, source: 'client_reported' })).not.toBeTypeOf('string');
  });

  it('round-trips readable sections for the lead profile', () => {
    const prepared = prepareLead(valid(commercial), 'agent@shield.test');
    const read = readIntakeSections(prepared.lead.form_payload as unknown as Record<string, unknown>);
    expect(read?.kind).toBe('commercial');
    const fields = read?.sections.flatMap((section) => section.fields.map((field) => `${field.label}=${field.value}`)) ?? [];
    expect(fields).toContain('Business type=Roofing contractor');
    expect(fields.some((field) => field.startsWith('Performs any roofing work?=Yes'))).toBe(true);
    expect(readIntakeSections({ metadata: {} })).toBeNull();
  });
});

describe('findExistingMatches', () => {
  const base = { business: null, address: null, state: null, zip: null, status: null, line_of_business: null };
  const rows = [
    { ...base, type: 'lead' as const, id: 'l1', full_name: 'Phone Only', email: null, phone: '+1 602-555-0142' },
    { ...base, type: 'account' as const, id: 'a1', full_name: 'Email Only', email: 'MARIA@example.com', phone: null },
    { ...base, type: 'lead' as const, id: 'l2', full_name: 'Both', email: 'maria@example.com', phone: '6025550142' },
    { ...base, type: 'lead' as const, id: 'l3', full_name: 'Nobody', email: 'x@y.com', phone: '4805550000' },
  ];

  it('ranks matches on both email and phone first, then accounts', () => {
    expect(findExistingMatches(rows, 'maria@example.com', '(602) 555-0142').map((row) => row.id)).toEqual(['l2', 'a1', 'l1']);
  });

  it('ignores partial phone numbers and empty input', () => {
    expect(findExistingMatches(rows, '', '555')).toEqual([]);
  });
});
