import { EMPTY_BUSINESS_SEARCH, type BusinessObservation, type BusinessResearchProfile, type BusinessSearchResult } from '@crm/shared';
import { test, expect, leadId } from './workspace-fixtures';

const businessId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const observation: BusinessObservation = {
  source: 'osm', record_id: 'node/12345', url: 'https://www.openstreetmap.org/node/12345', fetched_at: '2026-11-11T09:00:00Z', source_as_of: null,
  values: { name: 'Synthetic contractor', street: '1 Synthetic Street', city: 'Tucson', state: 'AZ', zip: '85701',
    phone: null, email: null, website: null, latitude: 32.2, longitude: -110.9, industry: 'Construction and trades',
    naics: null, classification: 'mapped', dot: null, ein: null, power_units: null, drivers: null, registration_reported_on: null,
    filing_year: null, assets: null, revenue: null },
};
const business = { id: businessId, name: observation.values.name, observations: [observation], updated_at: observation.fetched_at, status: 'partial' as const };
const searchResult: BusinessSearchResult = { run_id: businessId, businesses: [business], next_page: null,
  coverage: [{ source: 'osm', state: 'partial', message: 'OpenStreetMap contributors · ODbL. Community-maintained business coverage.' }] };
const profile: BusinessResearchProfile = { business, linked_record: null, job: { state: 'complete', error: null, result: {
  insights: [{ kind: 'question', text: 'Research a current business contact before outreach.', sources: ['osm:node/12345'] }],
  context: [], market_fit: null, coverage: [{ source: 'osha', state: 'unavailable', message: 'No address-corroborated establishment match.' }],
} } };
const tucson = { id: '0477000', name: 'Tucson', label: 'Tucson city', latitude: 32.154288, longitude: -110.871062 };
test.beforeEach(async ({ page }) => {
  await page.route('**/api/intelligence/map-tiles/**', (route) => route.fulfill({ status: 204 }));
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/intelligence/business-search-options?*', (route) => {
    const state = new URL(route.request().url()).searchParams.get('state');
    return route.fulfill({ json: { state, version: '2026', places: state === 'AZ' ? [tucson] : [{ id: '0644000', name: 'Los Angeles', label: 'Los Angeles city', latitude: 34.114, longitude: -118.406 }] } });
  });
});

test('industry and territory discover businesses without a name or producer source/review chores', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/intelligence/business-search', (route) => {
    requests.push(route.request().postDataJSON()); return route.fulfill({ json: searchResult });
  });
  await page.goto('/leads/finder');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]).toMatchObject({ filters: EMPTY_BUSINESS_SEARCH, page: 0 });
  const form = page.getByRole('form', { name: 'Find leads', exact: true });
  await form.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('contractor');
  await form.getByRole('combobox', { name: 'State', exact: true }).selectOption('AZ');
  await form.getByRole('combobox', { name: 'City', exact: true }).click();
  await form.getByRole('option', { name: 'Tucson city', exact: true }).click();
  await form.getByRole('button', { name: 'Find leads', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  await expect.poll(() => requests.some((request) => (request.filters as { industry: string }).industry === 'contractor')).toBe(true);
  expect(requests.at(-1)).toMatchObject({ filters: { ...EMPTY_BUSINESS_SEARCH, industry: 'contractor', state: 'AZ', city: 'Tucson', place_id: tucson.id }, page: 0 });
  expect(typeof requests[0].request_id).toBe('string');
  await expect(page.getByRole('combobox', { name: 'Search in' })).toHaveCount(0);
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Mark reviewed|Save business for review|Generate/i })).toHaveCount(0);
});

test('official six-digit NAICS and state-linked city selections support a radius and reset stale geography', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/intelligence/business-search', (route) => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: searchResult }); });
  await page.goto('/leads/finder');
  const form = page.getByRole('form', { name: 'Find leads', exact: true });
  await expect(form.getByRole('combobox', { name: 'City', exact: true })).toBeDisabled();
  await form.getByRole('combobox', { name: 'NAICS code', exact: true }).click();
  await form.getByRole('combobox', { name: 'NAICS code', exact: true }).fill('722511');
  await form.getByRole('option', { name: '722511 - Full-Service Restaurants', exact: true }).click();
  await form.getByRole('combobox', { name: 'State', exact: true }).selectOption('AZ');
  await form.getByRole('combobox', { name: 'City', exact: true }).click();
  await form.getByRole('option', { name: 'Tucson city', exact: true }).click();
  await form.getByRole('combobox', { name: 'Radius', exact: true }).selectOption('10');
  await form.getByRole('combobox', { name: 'Business contact', exact: true }).selectOption('phone');
  await form.getByRole('button', { name: 'Find leads', exact: true }).click();
  await expect.poll(() => requests.some((request) => (request.filters as { naics: string }).naics === '722511')).toBe(true);
  expect(requests.at(-1)).toMatchObject({ filters: { naics: '722511', city: 'Tucson', state: 'AZ', place_id: tucson.id, radius_miles: '10', contact: 'phone' } });
  await form.getByRole('combobox', { name: 'State', exact: true }).selectOption('CA');
  await expect(form.getByRole('combobox', { name: 'City', exact: true })).toHaveValue('');
  await expect(form.getByRole('combobox', { name: 'Radius', exact: true })).toHaveValue('');
  await form.getByRole('combobox', { name: 'City', exact: true }).click();
  await expect(form.getByRole('option', { name: 'Tucson city', exact: true })).toHaveCount(0);
  await form.getByRole('option', { name: 'Los Angeles city', exact: true }).click();
});

test('desktop filters stay aside and mobile results remain visible without overflow', async ({ page }) => {
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: searchResult }));
  await page.goto('/leads/finder');
  const filters = page.getByRole('complementary', { name: 'Lead search filters' });
  const results = page.getByRole('region', { name: 'Search results' });
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const filterBox = await filters.boundingBox(), resultBox = await results.boundingBox();
    if (!filterBox || !resultBox) throw new Error('Search workspace must have visible bounds.');
    expect(resultBox.x).toBeGreaterThanOrEqual(filterBox.x + filterBox.width);
    expect(Math.abs(resultBox.y - filterBox.y)).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('list', { name: 'Businesses' })).toBeVisible();
  await page.getByRole('button', { name: 'Show filters', exact: true }).click();
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show filters', exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Businesses' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('map area search uses the displayed bounds and marker selection opens the same researched profile', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ status: 204 }));
  await page.route('**/api/intelligence/business-search', (route) => { requests.push(route.request().postDataJSON()); return route.fulfill({ json: searchResult }); });
  await page.route('**/api/intelligence/business-research?*', (route) => route.fulfill({ json: profile }));
  await page.goto('/leads/finder');
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  await page.getByRole('combobox', { name: 'State', exact: true }).selectOption('AZ');
  await page.getByRole('combobox', { name: 'City', exact: true }).click();
  await page.getByRole('option', { name: 'Tucson city', exact: true }).click();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  const map = page.getByLabel('Business map', { exact: true });
  await expect(map.getByRole('button', { name: 'Search this map area' })).toBeEnabled();
  await map.getByRole('button', { name: 'Search this map area' }).click();
  await expect.poll(() => requests.some((request) => Boolean((request.filters as { map_bounds: string }).map_bounds))).toBe(true);
  const filters = requests.at(-1)!.filters as { map_bounds: string; radius_miles: string; zip: string };
  expect(filters.map_bounds.split(',').map(Number)).toHaveLength(4);
  expect(filters.radius_miles).toBe('');
  expect(filters.zip).toBe('');
  await map.locator('.leaflet-interactive').click();
  await expect(page.getByRole('region', { name: 'Business profile', exact: true })).toContainText('Synthetic contractor');
});

test('contactless research stays outside the pipeline until explicitly selected, then links the existing lead', async ({ page }) => {
  let saves = 0;
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: searchResult }));
  await page.route('**/api/intelligence/business-research?*', (route) => route.fulfill({ json: profile }));
  await page.route('**/api/intelligence/business-research', (route) => {
    expect(route.request().postDataJSON()).toEqual({ business_id: businessId });
    saves++; return route.fulfill({ json: { type: 'lead', id: leadId, already_saved: false } });
  });
  await page.goto('/leads/finder');
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await page.getByRole('button', { name: /Synthetic contractor/ }).click();
  const details = page.getByRole('region', { name: 'Business profile', exact: true });
  await expect(details.getByText('Research a current business contact before outreach.', { exact: true })).toBeVisible();
  expect(saves).toBe(0);
  await details.getByRole('button', { name: 'Add to leads', exact: true }).click();
  await expect(details.getByRole('link', { name: 'Open lead' })).toHaveAttribute('href', `/leads?lead=${leadId}&intelligence=1`);
  expect(saves).toBe(1);
  await expect(details.getByRole('button', { name: 'Add to leads', exact: true })).toHaveCount(0);
});

test('categorized profile distinguishes mapped categories, unknown insurance facts and unavailable research', async ({ page }) => {
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: searchResult }));
  await page.route('**/api/intelligence/business-research?*', (route) => route.fulfill({ json: profile }));
  await page.goto('/leads/finder');
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await page.getByRole('button', { name: /Synthetic contractor/ }).click();
  const details = page.getByRole('region', { name: 'Business profile', exact: true });
  await expect(details).not.toContainText('mapped category');
  await details.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await expect(details).toContainText('Phone not listed');
  await expect(details).toContainText('Confirm who you are speaking with');
  await expect(details.getByRole('tab', { name: 'Financial', exact: true })).toHaveCount(0);
  await expect(details.getByRole('tab', { name: 'Benefits & pension', exact: true })).toHaveCount(0);
  await details.getByRole('tab', { name: 'Sources', exact: true }).click();
  await expect(details).toContainText('OSHA: not available right now.');
  await expect(details).not.toContainText('HTTP');
  await expect(details).toContainText('OpenStreetMap contributors');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('source outages are explicit failures rather than empty successful discovery', async ({ page }) => {
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ status: 503, json: { message: 'Open-map source is temporarily unavailable.' } }));
  await page.goto('/leads/finder');
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Open-map source is temporarily unavailable.' })).toBeVisible();
  await expect(page.getByText('0 businesses on this page', { exact: true })).toHaveCount(0);
});

test('paused background research is labelled and does not keep polling', async ({ page }) => {
  let reads = 0;
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: searchResult }));
  await page.route('**/api/intelligence/business-research?*', (route) => {
    reads++;
    return route.fulfill({ json: { ...profile, job: { state: 'pending', paused: true, error: null, result: null } } });
  });
  await page.goto('/leads/finder');
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await page.clock.install();
  await page.getByRole('button', { name: /Synthetic contractor/ }).click();
  await expect(page.getByRole('region', { name: 'Business profile', exact: true })).toContainText('Automatic research is paused by the agency owner.');
  const initialReads = reads;
  await page.clock.fastForward(15000);
  expect(reads).toBe(initialReads);
});

test('clearing an in-flight search cannot restore stale results', async ({ page }) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/intelligence/business-search', async (route) => {
    if (route.request().postDataJSON().filters.query) await held;
    await route.fulfill({ json: searchResult });
  });
  await page.goto('/leads/finder');
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  await page.getByLabel('Business name or keyword', { exact: true }).fill('Synthetic');
  const pending = page.waitForRequest('**/api/intelligence/business-search');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await pending;
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  release?.();
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  await expect(page.getByLabel('Applied filters')).toBeEmpty();
  await expect(page.getByLabel('Business name or keyword', { exact: true })).toHaveValue('');
});

test('opening the Finder browses businesses without entering any search requirement', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/intelligence/business-search', (route) => {
    requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { ...searchResult, next_page: 4 } });
  });
  await page.goto('/leads/finder');
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  expect(requests[0]).toMatchObject({ filters: EMPTY_BUSINESS_SEARCH, page: 0 });
  await page.getByRole('button', { name: 'Next results', exact: true }).click();
  await expect.poll(() => requests.some((request) => request.page === 4)).toBe(true);
  expect(requests.at(-1)).toMatchObject({ filters: EMPTY_BUSINESS_SEARCH, page: 4 });
});

test('top pagination follows opaque server pages backwards and resets after changing filters', async ({ page }) => {
    const pages: number[] = [];
    await page.route('**/api/intelligence/business-search', (route) => {
      const body = route.request().postDataJSON(); pages.push(body.page);
      return route.fulfill({ json: { ...searchResult, next_page: body.page < 8 ? body.page + 4 : null } });
    });
    await page.goto('/leads/finder');
    const navigation = page.getByRole('navigation', { name: 'Business result pages' });
    await expect(page.getByRole('list', { name: 'Businesses' })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Previous results' })).toBeDisabled();
    for (const number of [2, 3]) {
      await navigation.getByRole('button', { name: 'Next results' }).click();
      await expect(navigation).toContainText(`Page ${number}`);
    }
    await expect(navigation.getByRole('button', { name: 'Next results' })).toBeDisabled();
    for (const number of [2, 1]) {
      await navigation.getByRole('button', { name: 'Previous results' }).click();
      await expect(navigation).toContainText(`Page ${number}`);
    }
    expect(pages).toEqual([0, 4, 8, 4, 0]);
    await navigation.getByRole('button', { name: 'Next results' }).click();
    await expect(navigation).toContainText('Page 2');
    await page.getByLabel('Business name or keyword', { exact: true }).fill('Narrow search');
    await page.getByRole('button', { name: 'Find leads', exact: true }).click();
    await expect(navigation).toContainText('Page 1');
    await expect(navigation.getByRole('button', { name: 'Previous results' })).toBeDisabled();
    expect(pages.at(-1)).toBe(0);
  });

test('compact results open a bounded popup and restore keyboard focus and list position on close', async ({ page }) => {
    const businesses = Array.from({ length: 25 }, (_, index) => ({ ...business,
      id: `168413e9-a6a4-4dff-a8bf-${String(index).padStart(12, '0')}`, name: `Synthetic business ${index + 1}` }));
    await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: { ...searchResult, businesses, next_page: 4 } }));
    await page.route('**/api/intelligence/business-research?*', (route) => route.fulfill({ json: profile }));
    await page.goto('/leads/finder');
    const list = page.getByRole('list', { name: 'Businesses' });
    await expect(list.getByRole('button')).toHaveCount(25);
    const listBox = await list.boundingBox();
    expect(listBox?.height).toBeLessThanOrEqual(540);
    const opener = list.getByRole('button', { name: /Synthetic business 25\b/ });
    await opener.scrollIntoViewIfNeeded();
    const position = await list.evaluate((element) => element.scrollTop);
    expect(position).toBeGreaterThan(0);
    await opener.click();
    const popup = page.getByRole('dialog', { name: 'Business profile', exact: true });
    await expect(popup.getByRole('region', { name: 'Business profile' })).toContainText('Synthetic contractor');
    await page.keyboard.press('Escape');
    await expect(popup).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await list.evaluate((element) => element.scrollTop)).toBe(position);
    await expect(page.getByRole('navigation', { name: 'Business result pages' })).toBeInViewport();
    await opener.click();
    await page.setViewportSize({ width: 390, height: 844 });
    const popupBox = await popup.boundingBox();
    if (!popupBox) throw new Error('Business popup must be visible on mobile.');
    expect(popupBox.width).toBeLessThanOrEqual(390);
    expect(popupBox.height).toBeLessThanOrEqual(844 * 0.9 + 1);
    await popup.getByRole('button', { name: 'Close profile' }).click();
    await expect(opener).toBeFocused();
  });

test('source tabs explain missing setup immediately and show dated FEMA/weather evidence when research finishes', async ({ page }) => {
    let reads = 0, finished = false;
    const readiness = { active_carrier_documents: 0, osha_configured: false, fmcsa_configured: false };
    await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: searchResult }));
    await page.route('**/api/intelligence/business-research?*', (route) => {
      reads++;
      return route.fulfill({ json: !finished ? { ...profile, readiness, job: { state: 'pending', error: null, result: null } }
        : { ...profile, readiness, job: { ...profile.job, result: { ...profile.job?.result, coverage: [
          { source: 'location', state: 'complete', message: 'Public source research completed.' },
          { source: 'fema', state: 'complete', message: 'Public source research completed.' },
          { source: 'nws', state: 'unavailable', message: 'NWS returned HTTP 503.' },
          { source: 'osha', state: 'unavailable', message: 'OSHA enrichment needs DOL_API_KEY in the server deployment.' },
        ], context: [{ category: 'property', label: 'FEMA mapped flood zone', value: 'AE. Not a certified flood determination.',
          url: 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query', fetched_at: '2026-11-11T09:00:00Z' }] } } } });
    });
    await page.goto('/leads/finder');
    await page.clock.install();
    await page.getByRole('button', { name: /Synthetic contractor/ }).click();
    const details = page.getByRole('region', { name: 'Business profile', exact: true });
    await details.getByRole('tab', { name: 'OSHA', exact: true }).click();
    await expect(details).toContainText('OSHA records are not connected yet.');
    await expect(details).not.toContainText('DOL_API_KEY');
    await details.getByRole('tab', { name: 'DOT & fleet', exact: true }).click();
    await expect(details).toContainText('No DOT registration found.');
    await expect(details).toContainText('DOT safety records are not connected yet.');
    await details.getByRole('tab', { name: 'Market fit', exact: true }).click();
    await expect(details).toContainText('Add your carrier appetite guides');
    await expect(details.getByRole('link', { name: 'Set up carrier appetite' })).toHaveAttribute('href', '/rashi/carrier-appetite');
    await details.getByRole('tab', { name: 'Risk & location', exact: true }).click();
    await expect(details).not.toContainText('32.2, -110.9');
    await expect(details).toContainText('Flood zone: checking...');
    finished = true;
    await page.clock.fastForward(5100);
    await expect(details).toContainText('FEMA mapped flood zone: AE.');
    await expect(details.locator('time')).toHaveAttribute('datetime', '2026-11-11T09:00:00Z');
    await expect(details).toContainText('Weather alerts: not available right now.');
    await expect(details).not.toContainText('HTTP 503');
    await expect(details).toContainText('does not mean low risk');
    expect(reads).toBeGreaterThan(1);
  });

test('an empty exact ZIP filter stays explicit and can be removed without clearing the industry', async ({ page }) => {
  const requests: Array<{ filters: typeof EMPTY_BUSINESS_SEARCH }> = [];
  await page.route('**/api/intelligence/business-search', (route) => {
    const body = route.request().postDataJSON(); requests.push(body);
    return route.fulfill({ json: body.filters.zip ? { ...searchResult, businesses: [], coverage: [] } : searchResult });
  });
  await page.goto('/leads/finder');
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  await page.getByRole('combobox', { name: 'Industry', exact: true }).selectOption('contractor');
  await page.getByLabel('ZIP code', { exact: true }).fill('85705');
  await page.getByRole('button', { name: 'Find leads', exact: true }).click();
  await expect(page.getByText('No businesses match these filters.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove ZIP filter', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  expect(requests.at(-1)?.filters).toMatchObject({ industry: 'contractor', zip: '' });
});

test('empty indexing results refresh automatically without another producer search', async ({ page }) => {
  let reads = 0;
  await page.clock.install();
  await page.route('**/api/intelligence/business-search', (route) => {
    reads++;
    return route.fulfill({ json: reads === 1 ? { ...searchResult, businesses: [],
      coverage: [{ source: 'osm', state: 'partial', message: 'Open-map businesses are indexing.' }] } : searchResult });
  });
  await page.goto('/leads/finder');
  await expect(page.getByText('Still gathering businesses for this area. Results will refresh automatically.', { exact: true })).toBeVisible();
  await page.clock.fastForward(15000);
  await expect(page.getByRole('list', { name: 'Businesses' })).toContainText('Synthetic contractor');
  expect(reads).toBe(2);
});

const googlePlace = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, address: '1 Main St, Tucson, AZ 85705, USA', phone: '(520) 555-0101',
  website: 'https://desert.example', maps_url: `https://maps.google.com/?cid=${id}`, category: 'Plumber', rating: 4.6, rating_count: 80, status: 'OPERATIONAL',
  latitude: 32.2, longitude: -110.9, ...extra });

test('one list merges Google-verified records with Google-only listings and pages both sources together', async ({ page }) => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route('**/api/intelligence/business-search', (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>; requests.push(body);
    const second = body.google_page_token === 'g-page-2';
    return route.fulfill({ json: second ? { ...searchResult, businesses: [], next_page: null,
      google: { state: 'complete', message: 'Google Maps listings.', next_page_token: null, places: [googlePlace('ChIJsecond00001', 'Second Page Plumbing')] } }
      : { ...searchResult, businesses: [{ ...business, google: googlePlace('ChIJmatched0001', 'Synthetic contractor') }],
        google: { state: 'complete', message: 'Google Maps listings.', next_page_token: 'g-page-2', places: [googlePlace('ChIJonly0000001', 'Desert Plumbing')] } } });
  });
  await page.goto('/leads/finder');
  const list = page.getByRole('list', { name: 'Businesses' });
  await expect(list.getByRole('button')).toHaveCount(2);
  await expect(list.getByRole('button').first()).toContainText('Verified by Google Maps');
  await expect(list.getByRole('button').first()).toContainText('(520) 555-0101');
  await expect(list.getByRole('button').nth(1)).toContainText('Desert Plumbing');
  await expect(page.getByRole('button', { name: 'Public records', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Google Maps', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next results' }).click();
  await expect(list).toContainText('Second Page Plumbing');
  expect(requests.at(-1)).toMatchObject({ page: 0, google_page_token: 'g-page-2', skip_records: true, skip_google: false });
  await expect(page.getByRole('button', { name: 'Next results' })).toBeDisabled();
});

test('a Google-only listing opens a live OIP profile with contacts, OSHA status and Add to leads', async ({ page }) => {
  const posted: Array<Record<string, unknown>> = [], leads: Array<Record<string, unknown>> = [];
  const place = googlePlace('ChIJonly0000001', 'Desert Plumbing');
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: { ...searchResult, businesses: [],
    google: { state: 'complete', message: 'Google Maps listings.', next_page_token: null, places: [place] } } }));
  await page.route('**/api/intelligence/business-research/google', (route) => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { profile: { business: { id: `google:${place.id}`, name: place.name, observations: [], status: 'partial', updated_at: '2026-11-11T09:00:00Z', google: place },
      linked_record: null, readiness: { active_carrier_documents: 0, osha_configured: true, fmcsa_configured: true },
      job: { state: 'complete', error: null, result: { insights: [], market_fit: null, context: [], coverage: [
        { source: 'osha', state: 'unavailable', message: 'OSHA check queued: the Department of Labor is limiting lookups. It fills in automatically after 08:27 UTC.' }] } } } } });
  });
  await page.route('**/api/leads', (route) => { leads.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { id: leadId } }); });
  await page.goto('/leads/finder');
  await page.getByRole('list', { name: 'Businesses' }).getByRole('button', { name: /Desert Plumbing/ }).click();
  const details = page.getByRole('region', { name: 'Business profile', exact: true });
  await expect(details).toContainText('Google Maps listing');
  await expect(details.getByRole('link', { name: 'Open in Google Maps' })).toHaveAttribute('href', place.maps_url);
  expect(posted[0]).toMatchObject({ place: { id: place.id, name: place.name } });
  await details.getByRole('tab', { name: 'OSHA', exact: true }).click();
  await expect(details).toContainText('OSHA inspections: checking now. Results will appear here automatically.');
  await details.getByRole('tab', { name: 'Contacts', exact: true }).click();
  await expect(details).toContainText('(520) 555-0101');
  await details.getByRole('button', { name: 'Add to leads' }).click();
  await expect(details.getByRole('link', { name: 'Open lead' })).toHaveAttribute('href', `/leads?lead=${leadId}`);
  expect(leads[0]).toMatchObject({ full_name: 'Desert Plumbing', phone: '(520) 555-0101', state: 'AZ', zip: '85705', source: 'Lead Finder' });
});

test('radius results show distance, nearest first, and draw the searched circle on the map', async ({ page }) => {
  const near = { ...business, id: '168413e9-a6a4-4dff-a8bf-000000000001', name: 'Near contractor', distance_miles: 1.2 };
  const far = { ...business, id: '168413e9-a6a4-4dff-a8bf-000000000002', name: 'Far contractor', distance_miles: 8.4 };
  await page.route('**/api/intelligence/business-search', (route) => route.fulfill({ json: { ...searchResult, businesses: [far, near],
    center: { latitude: tucson.latitude, longitude: tucson.longitude, radius_miles: 10 } } }));
  await page.goto('/leads/finder');
  const list = page.getByRole('list', { name: 'Businesses' });
  await expect(list.getByRole('button').first()).toContainText('Near contractor');
  await expect(list.getByRole('button').first()).toContainText('1.2 mi');
  await expect(page.getByRole('status').filter({ hasText: 'nearest first within 10 miles' })).toBeVisible();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.getByLabel('Business map', { exact: true }).locator('path.leaflet-interactive, path[stroke="#321fdb"]')).not.toHaveCount(0);
});