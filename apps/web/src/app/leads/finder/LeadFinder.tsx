'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { EMPTY_BUSINESS_SEARCH, RESEARCH_INDUSTRIES, RESEARCH_NAICS, RESEARCH_US_STATES,
  type BusinessSearchFilters, type BusinessSearchResult, type GooglePlace, type ResearchBusiness, type ResearchPlace } from '@crm/shared';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card';
import BusinessResearchPanel from '../../../components/crm/BusinessResearchPanel';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import ResearchSearchSelect from '../../../components/crm/ResearchSearchSelect';
import BusinessSearchMap, { type MapBusiness } from '../../../components/crm/BusinessSearchMap';

const control = 'mt-1 w-full min-w-0 rounded border border-cui-border bg-white px-3 py-2 text-sm';
interface FinderItem { id: string; name: string; business: ResearchBusiness | null; place: GooglePlace | null; distance: number | null }
/** One results page spans a public-records page and a Google Maps page; either side ends independently. */
interface Cursor { page: number; token: string; skipRecords: boolean; skipGoogle: boolean }
const FIRST_PAGE: Cursor = { page: 0, token: '', skipRecords: false, skipGoogle: false };
const hasContact = (business: ResearchBusiness): boolean => business.observations.some((item) => item.values.phone || item.values.email);
const FILTER_LABELS: Record<string, string> = {
  query: 'Keyword', industry: 'Industry', naics: 'NAICS', state: 'State', city: 'City', zip: 'ZIP', radius_miles: 'Radius', contact: 'Contact',
  min_power_units: 'Min trucks', max_power_units: 'Max trucks', min_revenue: 'Min revenue', max_revenue: 'Max revenue',
  benefits: 'Benefit plan', min_participants: 'Min plan members', max_participants: 'Max plan members',
};
const FILTER_VALUES: Record<string, Record<string, string>> = {
  contact: { any: 'Phone or email', phone: 'Phone', email: 'Email', website: 'Website' },
  benefits: { any: 'Benefit or pension', pension: 'Pension', welfare: 'Health or welfare' },
};
function filterChip(key: string, value: string): string {
  if (key === 'map_bounds') return 'Map area';
  if (key === 'radius_miles') return `Within ${value} miles`;
  if (key === 'industry') return RESEARCH_INDUSTRIES.find((item) => item.id === value)?.label ?? value;
  if (key === 'naics') return `${value} - ${RESEARCH_NAICS.find((item) => item.code === value)?.title ?? value}`;
  return `${FILTER_LABELS[key] ?? key}: ${FILTER_VALUES[key]?.[value] ?? value}`;
}
function nextCursor(result: BusinessSearchResult, cursor: Cursor): Cursor | null {
  const token = result.google?.next_page_token ?? '', records = !cursor.skipRecords && result.next_page != null;
  if (!records && !token) return null;
  return { page: records && result.next_page != null ? result.next_page : cursor.page, token, skipRecords: !records, skipGoogle: !token };
}
function finderItems(result: BusinessSearchResult | null): FinderItem[] {
  if (!result) return [];
  const rank = (item: FinderItem): number => item.business && item.place ? 0 : item.place ? 1 : item.business && hasContact(item.business) ? 2 : 3;
  const items = [
    ...result.businesses.map((business): FinderItem => ({ id: business.id, name: business.name, business, place: business.google ?? null, distance: business.distance_miles ?? null })),
    ...(result.google?.places ?? []).map((place): FinderItem => ({ id: `google:${place.id}`, name: place.name, business: null, place, distance: place.distance_miles ?? null })),
  ];
  return items.sort((a, b) => (result.center?.radius_miles ? (a.distance ?? Infinity) - (b.distance ?? Infinity) : 0) || rank(a) - rank(b));
}
function itemPoint(item: FinderItem): { latitude: number; longitude: number } | null {
  const values = item.business?.observations.find((entry) => entry.values.latitude !== null && entry.values.longitude !== null)?.values;
  if (values?.latitude != null && values.longitude != null) return { latitude: values.latitude, longitude: values.longitude };
  return item.place?.latitude != null && item.place.longitude != null ? { latitude: item.place.latitude, longitude: item.place.longitude } : null;
}
export default function LeadFinder(): JSX.Element {
  const [filters, setFilters] = useState<BusinessSearchFilters>({ ...EMPTY_BUSINESS_SEARCH });
  const [applied, setApplied] = useState<BusinessSearchFilters>({ ...EMPTY_BUSINESS_SEARCH });
  const [result, setResult] = useState<BusinessSearchResult | null>(null);
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [filtersOpen, setFiltersOpen] = useState(true);
  const [places, setPlaces] = useState<ResearchPlace[]>([]), [placesBusy, setPlacesBusy] = useState(false), [placesError, setPlacesError] = useState('');
  const [view, setView] = useState<'list' | 'map'>('list');
  const [pageTrail, setPageTrail] = useState<Cursor[]>([]);
  const items = useMemo(() => finderItems(result), [result]);
  const mapItems = useMemo(() => items.flatMap((item): MapBusiness[] => {
    const point = itemPoint(item);
    return point ? [{ id: item.id, name: item.name, ...point, google: !item.business }] : [];
  }), [items]);
  const chosen = items.find((item) => item.id === selected) ?? null;
  const cityCenter = places.find((place) => place.id === applied.place_id);
  const mapCenter = result?.center ?? (cityCenter ? { latitude: cityCenter.latitude, longitude: cityCenter.longitude, radius_miles: null } : null);
  const profileTrigger = useRef<HTMLElement | null>(null);
  const openProfile = (id: string): void => {
    profileTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(id);
  };
  useEffect(() => {
    const abort = new AbortController();
    setPlaces([]); setPlacesError('');
    if (!filters.state) { setPlacesBusy(false); return; }
    setPlacesBusy(true);
    void workspaceFetch<{ places: ResearchPlace[] }>(`/api/intelligence/business-search-options?state=${filters.state}`, { signal: abort.signal })
      .then((data) => { if (!abort.signal.aborted) setPlaces(data.places); })
      .catch((failure: unknown) => { if (!abort.signal.aborted) setPlacesError(failure instanceof Error ? failure.message : 'City choices could not be loaded.'); })
      .finally(() => { if (!abort.signal.aborted) setPlacesBusy(false); });
    return () => abort.abort();
  }, [filters.state]);
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  const update = (key: keyof BusinessSearchFilters, value: string): void => setFilters((current) => ({ ...current, [key]: value }));
  const search = useCallback(async (target: BusinessSearchFilters, cursor: Cursor = FIRST_PAGE, previousPages: Cursor[] = []): Promise<void> => {
    const version = ++generation.current;
    controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setError(''); setSelected(null); setResult(null); setFiltersOpen(false); setApplied(target);
    try {
      const data = await workspaceFetch<BusinessSearchResult>('/api/intelligence/business-search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.current.signal,
        body: JSON.stringify({ filters: target, page: cursor.page, request_id: crypto.randomUUID(),
          ...(cursor.token ? { google_page_token: cursor.token } : {}), skip_records: cursor.skipRecords, skip_google: cursor.skipGoogle }),
      });
      if (version === generation.current) { setResult(data); setPageTrail([...previousPages, cursor]); }
    } catch (failure) {
      if (version === generation.current) setError(failure instanceof Error ? failure.message : 'Business search failed.');
    } finally { if (version === generation.current) setBusy(false); }
  }, []);
  useEffect(() => { void search({ ...EMPTY_BUSINESS_SEARCH }); }, [search]);
  useEffect(() => {
    if (!result || items.length || !result.coverage.some((item) => /indexing|index.*incomplete/i.test(item.message))) return;
    const timer = setTimeout(() => { void search(applied); }, 15000);
    return () => clearTimeout(timer);
  }, [result, items, applied, search]);
  return <div className="space-y-4">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    <div className="grid items-start gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside aria-label="Lead search filters" className="min-w-0"><Card>
        <CardHeader actions={<button type="button" className="text-sm text-cui-primary underline lg:hidden" aria-controls="lead-finder-filters"
          aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>{filtersOpen ? 'Hide filters' : 'Show filters'}</button>}>Find leads</CardHeader>
        <CardBody className={filtersOpen ? undefined : 'hidden lg:block'}>
          <form id="lead-finder-filters" aria-label="Find leads" className="space-y-3" onSubmit={(event) => { event.preventDefault(); void search({ ...filters }); }}>
            <label className="block text-sm">Business name or keyword<input className={control} maxLength={120} value={filters.query} onChange={(event) => update('query', event.target.value)} /></label>
            <label className="block text-sm">Industry<select className={control} value={filters.industry} onChange={(event) => setFilters((current) => ({ ...current, industry: event.target.value, naics: '',
              min_power_units: '', max_power_units: '', min_revenue: '', max_revenue: '', contact: '',
              map_bounds: '', benefits: '', min_participants: '', max_participants: '' }))}>
              <option value="">All available categories</option>{RESEARCH_INDUSTRIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select></label>
            <ResearchSearchSelect label="NAICS code" value={filters.naics} placeholder="Search code or industry"
              options={RESEARCH_NAICS.map((item) => ({ value: item.code, label: `${item.code} - ${item.title}` }))}
              onChange={(code) => setFilters((current) => ({ ...current, naics: code, industry: '', min_power_units: '', max_power_units: '', min_revenue: '', max_revenue: '' }))} />
            <label className="block text-sm">State<select className={control} value={filters.state} onChange={(event) => setFilters((current) => ({
              ...current, state: event.target.value, city: '', place_id: '', zip: '', radius_miles: '', map_bounds: '',
            }))}>
              <option value="">All states</option>{RESEARCH_US_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
            </select></label>
            <ResearchSearchSelect label="City" value={filters.place_id} placeholder={!filters.state ? 'Choose a state first' : placesBusy ? 'Loading cities...' : 'Choose a city'}
              disabled={!filters.state || placesBusy || Boolean(placesError)} options={places.map((item) => ({ value: item.id, label: item.label }))}
              onChange={(id) => setFilters((current) => ({ ...current, place_id: id, city: places.find((place) => place.id === id)?.name ?? '', radius_miles: '', map_bounds: '' }))} />
            {placesError ? <p role="alert" className="text-xs text-cui-danger">{placesError}</p> : null}
            <label className="block text-sm">ZIP code<input className={control} inputMode="numeric" pattern="[0-9]{5}" maxLength={5} value={filters.zip}
              onChange={(event) => setFilters((current) => ({ ...current, zip: event.target.value, map_bounds: '' }))} /></label>
            <label className="block text-sm">Radius<select className={control} disabled={!filters.place_id}
              value={filters.radius_miles} onChange={(event) => setFilters((current) => ({ ...current, radius_miles: event.target.value, map_bounds: '' }))}>
              <option value="">{filters.place_id ? 'Whole city' : 'Choose a city first'}</option>{['5', '10', '25', '50'].map((miles) => <option key={miles} value={miles}>Within {miles} miles of {filters.city ? filters.city : 'city center'}</option>)}
            </select></label>
            <label className="block text-sm">Business contact<select className={control} value={filters.contact} onChange={(event) => update('contact', event.target.value)}>
              <option value="">Any</option><option value="any">Has phone or email</option><option value="phone">Has phone</option>
              <option value="email">Has email</option>{filters.industry !== 'trucking' && filters.industry !== 'nonprofit' ? <option value="website">Has website</option> : null}
            </select></label>
            {filters.industry === 'trucking' || filters.industry === 'nonprofit' ? <fieldset className="grid grid-cols-2 gap-2">
              <legend className="text-sm">{filters.industry === 'trucking' ? 'Trucks (power units)' : 'Annual revenue ($)'}</legend>
              {(['min', 'max'] as const).map((bound) => {
                const field = filters.industry === 'trucking' ? `${bound}_power_units` as const : `${bound}_revenue` as const;
                return <label key={bound} className="text-xs">{bound === 'min' ? 'Minimum' : 'Maximum'}<input className={control} type="number" min="0" max="999999999999" step="1"
                  value={filters[field]} onChange={(event) => update(field, event.target.value)} /></label>;
              })}
            </fieldset> : null}
            {filters.industry !== 'trucking' && filters.industry !== 'nonprofit' ? <details className="space-y-2">
              <summary className="cursor-pointer text-sm text-cui-primary">Employee benefits</summary>
              <label className="block text-sm">Benefit plan<select className={control} value={filters.benefits}
                onChange={(event) => setFilters((current) => ({ ...current, benefits: event.target.value, map_bounds: '' }))}>
                <option value="">Any business</option><option value="any">Has a benefit or pension plan</option><option value="pension">Has a pension plan</option><option value="welfare">Has a health or welfare plan</option>
              </select></label>
              <fieldset className="grid grid-cols-2 gap-2"><legend className="text-xs">Plan members</legend>
                {(['min_participants', 'max_participants'] as const).map((field) => <label key={field} className="text-xs">{field.startsWith('min') ? 'Minimum' : 'Maximum'}
                  <input className={control} type="number" min="0" max="999999999999" step="1" value={filters[field]}
                    onChange={(event) => setFilters((current) => ({ ...current, [field]: event.target.value, map_bounds: '' }))} /></label>)}
              </fieldset>
            </details> : null}
            <div className="flex flex-wrap items-center gap-3"><button disabled={busy} className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Searching...' : 'Find leads'}</button>
              <button type="button" className="text-sm text-cui-primary underline" onClick={() => {
                setFilters({ ...EMPTY_BUSINESS_SEARCH }); void search({ ...EMPTY_BUSINESS_SEARCH }); setFiltersOpen(true);
              }}>Clear filters</button>
            </div>
          </form>
        </CardBody>
      </Card></aside>
      <section aria-label="Search results" className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2 text-sm" aria-label="Search view">{(['list', 'map'] as const).map((mode) => <button key={mode} type="button"
            aria-pressed={view === mode} className={`rounded border px-3 py-1 ${view === mode ? 'border-cui-primary bg-white text-cui-primary' : 'border-cui-border'}`}
            onClick={() => setView(mode)}>{mode === 'list' ? 'List' : 'Map'}</button>)}</div>
          <nav aria-label="Business result pages" className="flex items-center gap-2 text-sm">
            <button type="button" disabled={busy || pageTrail.length < 2} className="rounded border border-cui-border bg-white px-3 py-1 disabled:opacity-50"
              onClick={() => { const previous = pageTrail[pageTrail.length - 2]; if (previous) void search(applied, previous, pageTrail.slice(0, -2)); }}>Previous results</button>
            <span className="whitespace-nowrap" aria-live="polite">Page {pageTrail.length || 1}</span>
            <button type="button" disabled={busy || !result || !nextCursor(result, pageTrail[pageTrail.length - 1] ?? FIRST_PAGE)}
              className="rounded border border-cui-border bg-white px-3 py-1 disabled:opacity-50"
              onClick={() => { const next = result && nextCursor(result, pageTrail[pageTrail.length - 1] ?? FIRST_PAGE); if (next) void search(applied, next, pageTrail); }}>Next results</button>
          </nav>
        </div>
        {view === 'map' ? <BusinessSearchMap businesses={mapItems} center={mapCenter} selected={selected} onSelect={openProfile} onSearchArea={(bounds) => {
          const next = { ...filters, map_bounds: bounds, radius_miles: '', zip: '', benefits: '', min_participants: '', max_participants: '' };
          setFilters(next); void search(next);
        }} /> : null}
        {busy ? <p role="status" className="text-sm">Searching...</p> : null}
        {!busy && !result && !error ? <p className="text-sm text-cui-muted">Browse available businesses or use any filters to narrow the results.</p> : null}
        {result ? <>
          <p role="status" className="text-sm">{items.length} {items.length === 1 ? 'business' : 'businesses'} on this page
            {result.center?.radius_miles ? ` · nearest first within ${result.center.radius_miles} miles` : ''}</p>
          <div aria-label="Applied filters" className="flex flex-wrap gap-1 text-xs">{Object.entries(applied).filter(([key, value]) => value && key !== 'place_id').map(([key, value]) =>
            <span key={key} className="rounded bg-white px-2 py-1">{filterChip(key, value)}</span>)}</div>
          {result.google?.state === 'unavailable' ? <p className="text-xs text-cui-muted">Google Maps listings are not available right now.</p> : null}
          {!items.length ? <div className="space-y-2 text-sm"><p>{result.coverage.some((item) => /indexing|index.*incomplete/i.test(item.message))
            ? 'Still gathering businesses for this area. Results will refresh automatically.'
            : 'No businesses match these filters.'}</p>
            {applied.zip ? <button type="button" className="text-cui-primary underline" onClick={() => {
              const next = { ...applied, zip: '' }; setFilters(next); void search(next);
            }}>Remove ZIP filter</button> : null}
          </div> : null}
          <ul aria-label="Businesses" className="max-h-[60vh] overflow-y-auto overscroll-contain rounded border border-cui-border bg-white">{items.map((item) => {
            const data = item.business?.observations[0]?.values, place = item.place;
            const address = [data?.street, data?.city, data?.state, data?.zip].filter(Boolean).join(', ') || place?.address || 'No address listed';
            const phone = place?.phone ?? item.business?.observations.find((entry) => entry.values.phone)?.values.phone ?? null;
            return <li key={item.id} className="border-b border-cui-border last:border-b-0"><button type="button" aria-haspopup="dialog" onClick={() => openProfile(item.id)}
              className="w-full px-3 py-2 text-left text-sm hover:bg-cui-bg focus-visible:bg-cui-bg">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-cui-primary">{item.name}</span>
                {item.business && place ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">Verified by Google Maps</span>
                  : place ? <span className="rounded bg-cui-bg px-1.5 py-0.5 text-xs font-semibold text-cui-primary">Google Maps</span> : null}
                {item.distance !== null ? <span className="text-xs text-cui-muted">{item.distance} mi</span> : null}
              </span>
              {item.business?.linked_record ? <span className="block text-xs font-semibold text-cui-primary">{item.business.linked_record.type === 'client' ? 'Existing account' : 'Saved lead'}</span> : null}
              <span className="block text-cui-muted">{address}</span>
              <span className="block text-xs">{data?.industry ?? place?.category ?? 'Industry unknown'}{data?.dot ? ` · DOT ${data.dot}` : ''}
                {phone ? ` · ${phone}` : item.business && hasContact(item.business) ? ' · Has contact info' : ' · No contact info'}
                {place?.rating ? ` · ★ ${place.rating}${place.rating_count ? ` (${place.rating_count})` : ''}` : ''}</span>
            </button></li>;
          })}</ul>
          <p className="text-xs text-cui-muted">{items.some((item) => item.place) ? 'Listings and contact details from Google Maps. ' : ''}
            {result.businesses.some((business) => business.observations.some((entry) => entry.source === 'osm')) ? '© OpenStreetMap contributors · ODbL' : ''}</p>
        </> : null}
      </section>
    </div>
    <Dialog.Root open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] flex max-h-[90dvh] w-[min(96vw,64rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded border border-cui-border bg-white shadow-xl"
          onCloseAutoFocus={(event) => { event.preventDefault(); profileTrigger.current?.focus({ preventScroll: true }); }}>
          <div className="flex items-center justify-between gap-3 border-b border-cui-border px-4 py-3">
            <Dialog.Title className="font-semibold">Business profile</Dialog.Title>
            <Dialog.Description className="sr-only">Business details.</Dialog.Description>
            <Dialog.Close asChild><button type="button" className="rounded border border-cui-border px-3 py-1 text-sm">Close profile</button></Dialog.Close>
          </div>
          <div className="min-h-0 overflow-y-auto p-3">
            {chosen ? <BusinessResearchPanel key={chosen.id} businessId={chosen.business?.id} place={chosen.place ?? undefined} /> : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
