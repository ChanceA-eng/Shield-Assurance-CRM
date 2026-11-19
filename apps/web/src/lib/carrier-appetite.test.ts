import { describe, it, expect } from 'vitest';
import { carrierAppetiteAvailability, type CarrierAppetiteValues } from '@crm/shared';
import { extractCarrierAppetite, extractCarrierAppetiteMetadata, parseAppetitePages, parseCarrierAppetite } from './carrier-appetite';

const pages = [{ page: 1, text: 'Preferred classes:\nRestaurants without delivery\nIneligible:\nRoofing contractors\nReferrals:\nRisks with prior losses\nLIMITS\nMaximum $2,000,000\n' }];
function values(): CarrierAppetiteValues {
  return { carrier: 'Example Insurance', title: '2026 appetite', line: 'General liability', states: 'AZ',
    effective_on: '2026-01-01', expires_on: '', access: 'unconfirmed', access_reference: '',
    rights_reference: 'Authorized agency carrier portal', rules: extractCarrierAppetite(pages) };
}
describe('carrier-document appetite', () => {
  it('extracts explicit classes and constraints with exact page evidence, not assumed eligibility', () => {
    const rules = extractCarrierAppetite(pages);
    expect(rules.map((rule) => rule.decision)).toEqual(['preferred', 'excluded', 'referral', 'needs_review']);
    expect(rules[0].criterion).toBe('Preferred classes: Restaurants without delivery');
    expect(rules[3].criterion).toContain('$2,000,000');
    expect(rules.every((rule) => pages[0].text.includes(rule.excerpt))).toBe(true);
  });
  it('does not carry one page heading into a new page or author rules from unrelated lead-like text', () => {
    expect(extractCarrierAppetite([{ page: 1, text: 'Name: Example Business\nImported lead: Restaurant\nRevenue: $250000' }])).toHaveLength(1);
    expect(extractCarrierAppetite([{ page: 1, text: 'ELIGIBLE CLASSES\nRestaurants' },
      { page: 2, text: 'Roofing contractors' }])).toHaveLength(1);
    expect(extractCarrierAppetite([{ page: 1, text: 'Business name: New Lead\nPhone: 5550000000' }])).toEqual([]);
  });
  it('keeps negative and referral wording stronger than positive headings', () => {
    const rules = extractCarrierAppetite([{ page: 1, text: 'PREFERRED CLASSES\nRestaurants not eligible with delivery\nHotels subject to approval' }]);
    expect(rules.map((rule) => rule.decision)).toEqual(['excluded', 'referral']);
  });
  it('never mixes carriers or silently copies source context between extractions', () => {
    const first = extractCarrierAppetite([{ page: 1, text: 'ELIGIBLE CLASSES\nRestaurants' }]);
    const second = extractCarrierAppetite([{ page: 1, text: 'INELIGIBLE CLASSES\nRestaurants' }]);
    expect(first[0].decision).toBe('eligible'); expect(second[0].decision).toBe('excluded');
    expect(first[0].id).not.toBe(second[0].id);
  });
  it('reads class/status tables without guessing the meaning of checkmarks or inheriting eligibility', () => {
    const rules = extractCarrierAppetite([{ page: 1, text: 'Class,Eligible,State\nRestaurants,Yes,AZ\nRoofing,No,AZ\nHotels,X,NV' }]);
    expect(rules.map((rule) => rule.decision)).toEqual(['eligible', 'excluded', 'needs_review']);
    expect(rules[0].criterion).toBe('Class: Restaurants; Eligible: Yes; State: AZ');
    expect(rules[2].excerpt).toBe('Hotels,X,NV');
  });
  it('keeps side-by-side category lists separate instead of reading them as one sentence', () => {
    const source = [{ page: 1, text: 'Preferred industries  Prohibited industries\nRestaurants  Roofing\nRetail stores  Demolition',
      layout: [
        { cells: [{ text: 'Preferred industries', x: 40, width: 130 }, { text: 'Prohibited industries', x: 320, width: 140 }] },
        { cells: [{ text: 'Restaurants', x: 40, width: 80 }, { text: 'Roofing', x: 320, width: 60 }] },
        { cells: [{ text: 'Retail stores', x: 40, width: 90 }, { text: 'Demolition', x: 320, width: 70 }] },
      ] }];
    const rules = extractCarrierAppetite(source);
    expect(rules.map((rule) => [rule.criterion, rule.decision])).toEqual([
      ['Preferred industries: Restaurants', 'preferred'], ['Prohibited industries: Roofing', 'excluded'],
      ['Preferred industries: Retail stores', 'preferred'], ['Prohibited industries: Demolition', 'excluded'],
    ]);
    expect(rules.every((rule) => source[0].text.includes(rule.excerpt))).toBe(true);
  });
  it('uses PDF column positions for table rows with missing cells', () => {
    const source = [{ page: 1, text: 'Industry  Notes  Appetite\nRestaurants  Preferred\nRoofing  Refer',
      layout: [
        { cells: [{ text: 'Industry', x: 40, width: 80 }, { text: 'Notes', x: 230, width: 50 }, { text: 'Appetite', x: 430, width: 60 }] },
        { cells: [{ text: 'Restaurants', x: 40, width: 80 }, { text: 'Preferred', x: 430, width: 70 }] },
        { cells: [{ text: 'Roofing', x: 40, width: 60 }, { text: 'Refer', x: 430, width: 40 }] },
      ] }];
    expect(extractCarrierAppetite(source).map((rule) => [rule.criterion, rule.decision])).toEqual([
      ['Industry: Restaurants; Appetite: Preferred', 'preferred'], ['Industry: Roofing; Appetite: Refer', 'referral'],
    ]);
  });
  it('reads target categories, wrapped restrictions and a separate submission column', () => {
    const layout = [
      { cells: [{ text: 'Carrier: Column Example', x: 40, width: 140 }] },
      { cells: [{ text: 'TARGET CLASSES', x: 40, width: 140 }, { text: 'HOW TO SUBMIT', x: 440, width: 100 }] },
      { cells: [{ text: 'RETAIL', x: 40, width: 60 }, { text: 'SERVICE BUSINESSES', x: 250, width: 140 }, { text: 'Submit through the portal', x: 440, width: 140 }] },
      { cells: [{ text: '- Book stores', x: 40, width: 100 }, { text: '- Equipment repair', x: 250, width: 130 }] },
      { cells: [{ text: '- Staff must have', x: 250, width: 120 }, { text: 'Include application forms', x: 440, width: 140 }] },
      { cells: [{ text: 'two years of training', x: 257, width: 130 }] },
      { cells: [{ text: 'EXPOSURES TO AVOID', x: 210, width: 180 }] },
      { cells: [{ text: '8 Explosives', x: 40, width: 90 }, { text: '8 High-rise', x: 250, width: 90 }] },
      { cells: [{ text: 'demolition', x: 257, width: 80 }] },
    ];
    const text = layout.map((row) => row.cells.map((cell) => cell.text).join('  ')).join('\n');
    const rules = extractCarrierAppetite([{ page: 1, text, layout }]);
    expect(rules.map((rule) => [rule.criterion, rule.decision])).toEqual([
      ['RETAIL', 'preferred'], ['SERVICE BUSINESSES', 'preferred'],
      ['RETAIL: Book stores', 'preferred'], ['SERVICE BUSINESSES: Equipment repair', 'preferred'],
      ['SERVICE BUSINESSES: Staff must have two years of training', 'condition'],
      ['Explosives', 'excluded'], ['High-rise demolition', 'excluded'],
    ]);
    expect(rules.every((rule) => text.includes(rule.excerpt))).toBe(true);
    expect(rules.every((rule) => rule.carrier === 'Column Example')).toBe(true);
    expect(rules.some((rule) => /portal|application/i.test(rule.criterion))).toBe(false);
  });
  it('does not treat an undated guide as a policy or require all entries to be classified', () => {
    const input = values();
    input.effective_on = ''; input.expires_on = ''; input.line = ''; input.states = '';
    expect(parseCarrierAppetite(input, pages).rules.at(-1)?.decision).toBe('needs_review');
    expect(carrierAppetiteAvailability({ state: 'active', values: { ...input, access: 'direct' } })).toBe('Available for matching');
  });
  it('extracts unambiguous carrier metadata but leaves multi-carrier or date ambiguity for review', () => {
    expect(extractCarrierAppetiteMetadata([{ text: 'Carrier: Example\nStates: AZ, NV\nEffective date: 2026-01-01\nProduct: General liability' }]))
      .toEqual({ carrier: 'Example', states: 'AZ, NV', effective_on: '2026-01-01', line: 'General liability' });
    expect(extractCarrierAppetiteMetadata([{ text: 'Carrier: First\nCarrier: Second\nEffective date: 01/02/26' }])).toEqual({});
    expect(extractCarrierAppetite([{ page: 1, text: 'ELIGIBLE CLASSES\nRESTAURANTS' }])[0].criterion).toContain('RESTAURANTS');
  });
  it('pins explicit carrier sections and table rows and refuses a mixed-carrier review', () => {
    const source = [{ page: 1, text: 'Carrier: First\nELIGIBLE CLASSES\nRestaurants\nCarrier: Second\nPROHIBITED CLASSES\nRoofing' }];
    const rules = extractCarrierAppetite(source);
    expect(rules.map((rule) => rule.carrier)).toEqual(['First', 'Second']);
    expect(() => parseCarrierAppetite({ ...values(), carrier: 'First', rules }, source)).toThrow('another carrier');
    expect(parseCarrierAppetite({ ...values(), carrier: 'First', rules: [rules[0]] }, source).rules).toHaveLength(1);
    const table = extractCarrierAppetite([{ page: 1, text: 'Carrier,Class,Status\nFirst,Restaurants,Eligible\nSecond,Restaurants,Ineligible' }]);
    expect(table.map((rule) => [rule.carrier, rule.decision])).toEqual([['First', 'eligible'], ['Second', 'excluded']]);
  });
  it('keeps edited or wrong-page evidence as unresolved notes without blocking the guide', () => {
    const input = values();
    expect(parseCarrierAppetite(input, pages).rules).toHaveLength(4);
    input.rules[0].excerpt = 'Restaurants WITHOUT delivery';
    let parsed = parseCarrierAppetite(input, pages);
    expect(parsed.rules).toHaveLength(3);
    expect(parsed.unresolved_entries).toHaveLength(1);
    input.rules[0].excerpt = 'Restaurants without delivery'; input.rules[0].page = 2;
    parsed = parseCarrierAppetite(input, pages);
    expect(parsed.rules).toHaveLength(3);
    expect(parsed.unresolved_entries?.[0].page).toBeNull();
    expect(parseCarrierAppetite(parsed, pages)).toEqual(parsed);
  });
  it('repairs duplicate internal IDs while still rejecting impossible dates', () => {
    const input = values(); input.rules[1].id = input.rules[0].id;
    const result = parseCarrierAppetite(input, pages);
    expect(new Set(result.rules.map((rule) => rule.id)).size).toBe(result.rules.length);
    expect(() => parseCarrierAppetite({ ...values(), effective_on: '2026-02-30' }, pages)).toThrow('calendar dates');
    expect(() => parseCarrierAppetite({ ...values(), expires_on: '2025-01-01' }, pages)).toThrow('precede');
  });
  it('repairs PDF column spacing using the exact stored source text', () => {
    const source = [{ page: 1, text: 'Industry Appetite\nBook stores Preferred' }];
    const rules = extractCarrierAppetite([{ ...source[0], layout: [
      { cells: [{ text: 'Industry', x: 40, width: 40 }, { text: 'Appetite', x: 86, width: 40 }] },
      { cells: [{ text: 'Book stores', x: 40, width: 40 }, { text: 'Preferred', x: 86, width: 40 }] },
    ] }]);
    expect(rules[0].excerpt).toBe('Book stores  Preferred');
    const parsed = parseCarrierAppetite({ ...values(), rules }, source);
    expect(parsed.rules[0].excerpt).toBe('Book stores Preferred');
    expect(parsed.rules[0].decision).toBe('preferred');
    expect(parsed.unresolved_entries).toBeUndefined();
  });
  it('does not make the producer supply an internal ID or extracted decision', () => {
    const parsed = parseCarrierAppetite({ ...values(), rules: [{ criterion: 'Restaurants', page: 1, excerpt: 'Restaurants' }] }, pages);
    expect(parsed.rules[0]).toMatchObject({ criterion: 'Restaurants', decision: 'needs_review', page: 1, excerpt: 'Restaurants' });
    expect(parsed.rules[0].id).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('saves uploaded guidance without rights or appointment proof', () => {
    const { rights_reference, access_reference, ...input } = values();
    for (const access of ['direct', 'mga_wholesaler'] as const) {
      expect(parseCarrierAppetite({ ...input, access }, pages)).toMatchObject({ access, rights_reference: '', access_reference: '' });
      expect(parseCarrierAppetite({ ...values(), rights_reference: '', access_reference: '', access }, pages).rules).toHaveLength(4);
    }
  });
  it('does not turn approval into current eligibility or a confirmed market appointment', () => {
    const input = values();
    expect(carrierAppetiteAvailability({ state: 'draft', values: input }, '2026-11-11')).toBe('Saved draft');
    expect(carrierAppetiteAvailability({ state: 'active', values: input }, '2026-11-11')).toBe('Agency access unconfirmed');
    expect(carrierAppetiteAvailability({ state: 'active', values: { ...input, effective_on: '2027-01-01' } }, '2026-11-11')).toBe('Not yet effective');
    expect(carrierAppetiteAvailability({ state: 'active', values: { ...input, expires_on: '2026-10-01' } }, '2026-11-11')).toBe('Expired');
  });
  it('validates private text without imposing a page-count ceiling', () => {
    const long = Array.from({ length: 125 }, (_, index) => ({ page: index + 1, text: `Page ${index + 1}` }));
    expect(parseAppetitePages(long)).toHaveLength(125);
    expect(() => parseAppetitePages([{ page: 2, text: 'Missing page' }])).toThrow('consecutive');
    expect(() => parseAppetitePages([{ page: 1, text: 'x'.repeat(1500001) }])).toThrow('review size');
  });
});
