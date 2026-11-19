'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { BusinessResearchProfile, GooglePlace, RecordTarget, ResearchJobResult } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import ResearchLocationMap from './ResearchLocationMap';
import WorkersCompPanel from './WorkersCompPanel';

const PENDING_CHECK = /OSHA check queued|rate-limiting OSHA/;

const tabs = ['Overview', 'Contacts', 'Workers’ comp', 'DOT & fleet', 'OSHA', 'Benefits & pension', 'Risk & location', 'Financial', 'Market fit', 'Sources'] as const;
const SOURCE_NAMES: Record<string, string> = {
  osm: 'OpenStreetMap', irs: 'IRS nonprofit records', dol_5500: 'Employee benefit filings', fmcsa_census: 'DOT registration',
  fmcsa_qc: 'DOT safety record', osha: 'OSHA', fema: 'Flood zone', nws: 'Weather alerts', location: 'Address check',
};
const sourceName = (source: string): string => SOURCE_NAMES[source] ?? source;
function SourceStatus({ source, label, profile }: { source: string; label: string; profile: BusinessResearchProfile }): JSX.Element {
  const coverage = profile.job?.result?.coverage.find((item) => item.source === source);
  if (coverage?.state === 'unavailable' && PENDING_CHECK.test(coverage.message)) return <p role="status" className="text-xs text-cui-muted">{label}: checking now. Results will appear here automatically.</p>;
  const detail = coverage?.state === 'complete' && coverage.message !== 'Public business evidence retrieved.' ? ` ${coverage.message}` : '';
  return <p className="text-xs text-cui-muted">{label}: {coverage ? coverage.state === 'complete' ? `checked.${detail}`
    : coverage.state === 'not_applicable' ? 'not needed for this business.' : 'not available right now. Use Refresh to check again.'
    : profile.job?.paused ? 'paused.'
    : profile.job?.state === 'failed' ? 'could not be checked. Use Refresh to try again.'
    : profile.job?.state === 'complete' ? 'nothing found.' : 'checking...'}</p>;
}
function ContextFacts({ items }: { items: ResearchJobResult['context'] }): JSX.Element {
  return <>{items.map((item, index) => <div key={`${item.label}:${index}`} className="space-y-1">
    <p><a href={item.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-cui-primary underline">{item.label}</a>: {item.value}</p>
    <p className="text-xs text-cui-muted">Retrieved <time dateTime={item.fetched_at}>{new Date(item.fetched_at).toLocaleString()}</time></p>
  </div>)}</>;
}
function googleAddressParts(value: string | null): { state: string | null; zip: string | null } {
  const match = /,\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?(?:,\s*USA)?$/.exec(value ?? '');
  return { state: match?.[1] ?? null, zip: match?.[2] ?? null };
}
function externalWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:/i.test(value) ? value : `https://${value}`);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export default function BusinessResearchPanel({ businessId, target, place }: { businessId?: string; target?: RecordTarget; place?: GooglePlace }): JSX.Element {
  const [profile, setProfile] = useState<BusinessResearchProfile | null>(null);
  const [tab, setTab] = useState<typeof tabs[number]>('Overview');
  const [branchId, setBranchId] = useState<string | null>(null), [branches, setBranches] = useState<NonNullable<BusinessResearchProfile['branches']>>([]);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);
  const [resolvedId, setResolvedId] = useState(businessId), [addedLead, setAddedLead] = useState<string | null>(null);
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined;
    setProfile(null); setError(''); setTab('Overview');
    const id = branchId ?? resolvedId;
    const query = id ? `id=${encodeURIComponent(id)}` : `target_type=${target?.type}&target_id=${target?.id}`;
    const waitingOnOsha = (data: BusinessResearchProfile): boolean => Boolean(data.job?.result?.coverage.some((item) => item.source === 'osha'
      && item.state === 'unavailable' && PENDING_CHECK.test(item.message)));
    const load = async (): Promise<void> => {
      try {
        if (!id && place) {
          const live = await workspaceFetch<{ business_id?: string; profile?: BusinessResearchProfile }>('/api/intelligence/business-research/google', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ place }),
          });
          if (!active) return;
          if (live.business_id) { setResolvedId(live.business_id); return; }
          if (live.profile) { setProfile(live.profile); if (waitingOnOsha(live.profile)) timer = setTimeout(() => { void load(); }, 30000); }
          return;
        }
        const data = await workspaceFetch<BusinessResearchProfile>(`/api/intelligence/business-research?${query}`);
        if (!active) return;
        setProfile(data);
        if (data.branches) setBranches(data.branches);
        if (!data.job?.paused && (data.job?.state === 'pending' || data.job?.state === 'processing')) timer = setTimeout(() => { void load(); }, 5000);
        else if (waitingOnOsha(data)) timer = setTimeout(() => { void load(); }, 30000);
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : 'This business could not be loaded.'); }
    };
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [resolvedId, place, target?.id, target?.type, branchId, reload]);
  const business = profile?.business, observations = business?.observations ?? [], primary = observations[0]?.values;
  const google = business?.google ?? place ?? null, googleOnly = Boolean(business?.id.startsWith('google:'));
  const googleWebsite = externalWebsite(google?.website ?? null);
  const address = [primary?.street, primary?.city, primary?.state, primary?.zip].filter(Boolean).join(', ') || google?.address || 'Address not reported';
  const result = profile?.job?.result;
  const record = profile?.linked_record;
  const mapped = observations.find((item) => item.values.latitude !== null && item.values.longitude !== null);
  const latitude = mapped?.values.latitude ?? google?.latitude, longitude = mapped?.values.longitude ?? google?.longitude;
  const visibleTabs = tabs.filter((name) => {
    if (name === 'Benefits & pension') return observations.some((item) => item.values.benefits);
    if (name === 'Financial') return Boolean(result?.financials) || observations.some((item) => item.source === 'irs' || item.values.assets !== null || item.values.revenue !== null);
    return true;
  });
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab('Overview'); }, [profile, tab]);
  return <section aria-label="Business profile" className="min-w-0 space-y-3 rounded border border-cui-border bg-white p-3">
    <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{business?.name ?? 'Business details'}</h3>
      <button type="button" disabled={busy} className="text-xs text-cui-primary underline" onClick={() => setReload((value) => value + 1)}>Refresh</button></div>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {!profile && !error ? <p role="status" className="text-sm">Loading business...</p> : null}
    {profile && !business ? <p className="text-sm text-cui-muted">No business details found yet.</p> : null}
    {business ? <>
      {branches.length > 1 ? <label className="block text-xs">Business location<select className="mt-1 w-full rounded border border-cui-border px-2 py-2"
        value={business.id} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label> : null}
      {record ? <Link className="text-sm text-cui-primary underline" href={record.type === 'client' ? `/clients/${record.id}` : `/leads?lead=${record.id}&intelligence=1`}>Open {record.type === 'client' ? 'account' : 'lead'}</Link>
        : googleOnly && google ? addedLead ? <Link className="text-sm text-cui-primary underline" href={`/leads?lead=${addedLead}`}>Open lead</Link>
        : <button type="button" className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}
          onClick={() => {
            const parts = googleAddressParts(google.address);
            setBusy(true); setError('');
            void workspaceFetch<{ id: string }>('/api/leads', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ full_name: google.name, business: google.name, phone: google.phone ?? undefined, state: parts.state ?? undefined,
                zip: parts.zip ?? undefined, details: [google.address, google.website, google.maps_url].filter(Boolean).join('\n'),
                source: 'Lead Finder', line_of_business: 'Commercial' }),
            }).then((saved) => setAddedLead(saved.id))
              .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Business could not be added.'))
              .finally(() => setBusy(false));
          }}>{busy ? 'Adding...' : 'Add to leads'}</button>
        : businessId || resolvedId ?
        <button type="button" className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy}
          onClick={() => {
            setBusy(true); setError('');
            void workspaceFetch<{ type: 'lead' | 'client'; id: string }>('/api/intelligence/business-research', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ business_id: business.id }),
            }).then((saved) => setProfile((current) => current ? { ...current, linked_record: { type: saved.type, id: saved.id } } : current))
              .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Business could not be added.'))
              .finally(() => setBusy(false));
          }}>{busy ? 'Adding...' : 'Add to leads'}</button> : null}
      <p role="status" className="text-xs text-cui-muted">{profile?.job?.paused ? 'Automatic research is paused by the agency owner.'
        : profile?.job?.state === 'failed' ? 'Some details could not be gathered. Use Refresh to try again.'
        : profile?.job?.state === 'complete' ? `Details up to date${result?.coverage.some((item) => item.state === 'unavailable' && !PENDING_CHECK.test(item.message)) ? ' · Some details are not available right now' : ''}`
        : 'Gathering details on this business...'}</p>
      <div role="tablist" aria-label="Business data" className="flex flex-wrap gap-1 border-b border-cui-border pb-2">
        {visibleTabs.map((name) => <button type="button" key={name} role="tab" aria-selected={tab === name}
          className={`rounded px-2 py-1 text-xs ${tab === name ? 'bg-cui-primary text-white' : 'bg-cui-bg text-cui-primary'}`} onClick={() => setTab(name)}>{name}</button>)}
      </div>
      <div role="tabpanel" aria-label={tab} className="space-y-3 text-sm">
        <div hidden={tab !== 'Workers’ comp'}><WorkersCompPanel key={target ? `${target.type}:${target.id}` : business.id}
          target={target} businessName={business.name} address={address === 'Address not reported' ? '' : address} /></div>
        {tab === 'Overview' ? <>
          <p>{address}</p>
          <p>{primary?.industry ?? google?.category ?? 'Industry unknown'}</p>
          {primary?.naics ? <p>NAICS code: {primary.naics}</p> : null}
          {google ? <div className="space-y-1 rounded border border-cui-border bg-cui-bg p-2">
            <p className="text-xs font-semibold">{googleOnly ? 'Google Maps listing' : 'Verified by Google Maps'}</p>
            <p>{google.phone ?? 'Phone not listed'}{googleWebsite ? <> · <a href={googleWebsite} target="_blank" rel="noopener noreferrer" className="text-cui-primary underline">Website</a></> : null}</p>
            {google.rating ? <p>★ {google.rating}{google.rating_count ? ` from ${google.rating_count} reviews` : ''}</p> : null}
            {google.status && google.status !== 'OPERATIONAL' ? <p className="text-amber-800">{google.status === 'CLOSED_PERMANENTLY' ? 'Permanently closed' : google.status === 'CLOSED_TEMPORARILY' ? 'Temporarily closed' : 'May not be open'}</p> : null}
          </div> : null}
          <a target="_blank" rel="noopener noreferrer" className="inline-block text-cui-primary underline"
            href={google?.maps_url ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([business.name, primary?.street, primary?.city, primary?.state].filter(Boolean).join(', '))}`}>Open in Google Maps</a>
          {result?.insights.map((item, index) => <p key={index} className={item.kind === 'conflict' ? 'text-amber-800' : ''}>{item.text}</p>)}
          {!result ? <p className="text-cui-muted">Confirm the current carrier, renewal date and decision maker on the call.</p> : null}
        </> : null}
        {tab === 'Benefits & pension' ? <>
          {observations.filter((item) => item.values.benefits).map((item) => {
            const benefits = item.values.benefits;
            if (!benefits) return null;
            return <div key={`${item.source}:${item.record_id}`} className="space-y-1">
              <a href={item.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-cui-primary underline">{benefits.plan_name}</a>
              <p>{benefits.pension_codes ? 'Pension plan' : benefits.welfare_codes ? 'Health or welfare plan' : 'Benefit plan'} · Plan year ended {benefits.period_end ?? 'unknown'}</p>
              <p>Plan members: {benefits.participants ?? 'unknown'} · Active members: {benefits.active_participants ?? 'unknown'}</p>
              {benefits.contracts?.map((contract, index) => <p key={index}>
                <a href={contract.url} target="_blank" rel="noopener noreferrer" className="text-cui-primary underline">{contract.insurer ?? 'Carrier not listed'}</a>
                {' '}· Policy {contract.policy_from ?? 'unknown'} to {contract.policy_to ?? 'unknown'}
              </p>)}
              <p className="text-xs text-cui-muted">From the company's latest benefit plan filing. Plan members are not the same as employees.</p>
            </div>;
          })}
          {!observations.some((item) => item.values.benefits) ? <p>No benefit plan found.</p> : null}
        </> : null}
        {tab === 'Contacts' ? <>
          {google ? <div className="space-y-1">
            <p className="text-xs font-semibold">Google Maps</p>
            <p>{google.phone || 'Phone not listed'}</p>
            {googleWebsite ? <a href={googleWebsite} target="_blank" rel="noopener noreferrer" className="break-all text-cui-primary underline">Business website</a> : null}
            <p>{google.address ?? 'Address not listed'}</p>
          </div> : null}
          {observations.map((item) => {
            const website = externalWebsite(item.values.website);
            return <div key={`${item.source}:${item.record_id}`} className="space-y-1">
              <p className="text-xs font-semibold">{sourceName(item.source)}</p>
              <p>{item.values.phone || 'Phone not listed'}</p><p className="break-all">{item.values.email || 'Email not listed'}</p>
              {website ? <a href={website} target="_blank" rel="noopener noreferrer" className="break-all text-cui-primary underline">Business website</a> : null}
            </div>;
          })}
          <p className="text-xs text-cui-muted">Listed contacts may be out of date. Confirm who you are speaking with.</p>
        </> : null}
        {tab === 'DOT & fleet' ? <>
          {observations.filter((item) => item.values.dot).map((item) => <div key={item.record_id}>
            <p>USDOT {item.values.dot}</p><p>Power units: {item.values.power_units ?? 'Unknown'} · Drivers: {item.values.drivers ?? 'Unknown'}</p>
            <p className="text-xs">Last DOT update: {item.values.registration_reported_on ?? 'Unknown'}</p>
          </div>)}
          {!observations.some((item) => item.values.dot) ? <p>No DOT registration found. The business may still have vehicles.</p> : null}
          {result?.fmcsa_candidates?.map((candidate) => <div key={candidate.dot_number} className="space-y-1 rounded border border-cui-border p-2">
            <p className="font-semibold">Possible DOT match: {candidate.legal_name}{candidate.dba_name ? ` (DBA ${candidate.dba_name})` : ''}</p>
            <p>USDOT {candidate.dot_number} · {[candidate.physical_address, candidate.city, candidate.state].filter(Boolean).join(', ') || 'Address not listed'}</p>
            <p>Operating status: {candidate.operating_status ?? 'Unknown'} · Safety rating: {candidate.safety_rating ?? 'Not rated'}</p>
            <p>Power units: {candidate.power_units ?? 'Unknown'} · Drivers: {candidate.drivers ?? 'Unknown'} · Inspections: {candidate.inspections_total ?? 'Unknown'} · Crashes: {candidate.crashes_total ?? 'Unknown'}</p>
            <a href={`https://safer.fmcsa.dot.gov/query.asp?searchtype=ANY&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=${encodeURIComponent(candidate.dot_number)}`}
              target="_blank" rel="noopener noreferrer" className="text-cui-primary underline">Check official DOT record</a>
            <p className="text-xs text-cui-muted">Name match only. Confirm the DOT number and address before using these details.</p>
          </div>)}
          <ContextFacts items={result?.context.filter((item) => item.category === 'fleet') ?? []} />
          {profile?.readiness?.fmcsa_configured === false ? <p className="text-xs">DOT safety records are not connected yet. Ask your administrator to connect them.</p>
            : profile ? <SourceStatus source="fmcsa_qc" label="DOT safety record" profile={profile} /> : null}
        </> : null}
        {tab === 'Risk & location' ? <>
          <p>{address}</p>
          {typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)
            ? <ResearchLocationMap latitude={latitude} longitude={longitude} label={business.name} /> : null}
          <ContextFacts items={result?.context.filter((item) => item.category === 'property' || item.category === 'weather') ?? []} />
          {profile ? <div className="space-y-2">
            <SourceStatus source="location" label="Address check" profile={profile} />
            <SourceStatus source="fema" label="Flood zone" profile={profile} />
            <SourceStatus source="nws" label="Weather alerts" profile={profile} />
          </div> : null}
          <p className="text-xs text-cui-muted">No flood or weather records does not mean low risk.</p>
        </> : null}
        {tab === 'OSHA' ? <>
          <ContextFacts items={result?.context.filter((item) => item.category === 'workplace') ?? []} />
          {result?.osha_candidates?.map((candidate) => <div key={candidate.activity_nr} className="space-y-1 rounded border border-cui-border p-2">
            <p className="font-semibold">Possible OSHA record: {candidate.establishment}</p>
            <p>{[candidate.street, candidate.city, candidate.state, candidate.zip].filter(Boolean).join(', ') || 'Address not listed'}
              {candidate.open_date ? ` · Opened ${candidate.open_date.slice(0, 10)}` : ''}</p>
            <a href={`https://www.osha.gov/ords/imis/establishment.inspection_detail?id=${encodeURIComponent(candidate.activity_nr)}`}
              target="_blank" rel="noopener noreferrer" className="text-cui-primary underline">Check official inspection record</a>
            <p className="text-xs text-cui-muted">Possible name match only. This record has not been linked to the business.</p>
          </div>)}
          {profile?.readiness?.osha_configured === false ? <p className="text-xs">OSHA records are not connected yet. Ask your administrator to connect them.</p>
            : profile ? <SourceStatus source="osha" label="OSHA inspections" profile={profile} /> : null}
          {!result?.context.some((item) => item.category === 'workplace') && !result?.osha_candidates?.length
            && profile?.job?.result?.coverage.some((item) => item.source === 'osha' && item.state === 'complete')
            ? <p className="text-xs text-cui-muted">No inspection was confirmed for this business. OSHA searches do not establish a complete safety history.</p> : null}
        </> : null}
        {tab === 'Financial' ? <>
          {result?.financials ? <div className="space-y-2">
            <a href={result.financials.url} target="_blank" rel="noopener noreferrer" className="text-cui-primary underline">
              IRS Form {result.financials.return_type} · Period ended {result.financials.period_end}
            </a>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt>Revenue</dt><dd>{result.financials.revenue?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? 'Unknown'}</dd>
              <dt>Assets</dt><dd>{result.financials.assets?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? 'Unknown'}</dd>
              <dt>Expenses</dt><dd>{result.financials.expenses?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? 'Unknown'}</dd>
              <dt>Employees (tax year)</dt><dd>{result.financials.employees?.toLocaleString('en-US') ?? 'Unknown'}</dd>
            </dl>
          </div> : null}
          {observations.filter((item) => item.source === 'irs' && item.values.ein).map((item) => <details key={item.record_id} open={!result?.financials} className="space-y-1">
            <summary className="cursor-pointer">IRS nonprofit record · {item.values.filing_year ?? 'year unknown'}</summary>
            <p>Reported assets: {item.values.assets?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? 'Unknown'}</p>
            <p>Reported revenue: {item.values.revenue?.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) ?? 'Unknown'}</p>
          </details>)}
          {!result?.financials && !observations.some((item) => item.source === 'irs') ? <p>No public financial filing found.</p> : null}
          <p className="text-xs text-cui-muted">Figures are from the latest tax filing and may have changed.</p>
        </> : null}
        {tab === 'Market fit' ? <>
          {profile?.readiness?.active_carrier_documents === 0 || result?.market_fit?.markets.length === 0 ? <div className="space-y-2">
            <p>{profile?.readiness && profile.readiness.active_carrier_documents > 0
              ? 'None of your carriers matched this business yet.'
              : 'Add your carrier appetite guides to see which carriers fit this business.'}</p>
            <Link href={{ pathname: '/rashi/carrier-appetite' }} className="inline-block rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white">
              {profile?.readiness && profile.readiness.active_carrier_documents > 0 ? 'Review carrier appetite' : 'Set up carrier appetite'}</Link>
          </div> : result?.market_fit ? <>
          <p>{result.market_fit.next_step}</p>
          {result.market_fit.markets.map((market) => <details key={market.document_id} open={market.status !== 'excluded'}>
            <summary className="cursor-pointer font-semibold">{market.carrier} · {market.coverage || market.title} · {{ possible_fit: 'Shortlist', needs_review: 'Review details', excluded: 'Not a fit' }[market.status]}</summary>
            {market.recommendation ? <p className="mt-2">{market.recommendation}</p> : null}
            {market.summary ? <p className="mt-2 text-sm text-cui-muted">{market.summary}</p> : null}
            <ul className="mt-2 list-disc space-y-1 pl-4">{market.reasons.slice(0, 4).map((reason) => <li key={reason}>{reason}</li>)}</ul>
            <details className="mt-2"><summary className="cursor-pointer text-cui-primary">Matching details and source pages</summary>
              {market.reasons.length > 4 ? <ul className="mt-2 list-disc pl-4">{market.reasons.slice(4).map((reason) => <li key={reason}>{reason}</li>)}</ul> : null}
              {market.rules.map((rule) => <div className="mt-2 text-xs" key={rule.id}><p>{rule.criterion} · {{ matched: 'Matches', not_matched: 'Does not match', unknown: 'Needs confirmation' }[rule.result]}</p>
                <details><summary className="cursor-pointer">Source page {rule.page}</summary><blockquote>{rule.excerpt}</blockquote></details></div>)}
            </details>
          </details>)}
        </> : <p>{profile?.job?.paused ? 'Carrier matching is paused.'
          : profile?.job?.state === 'failed' ? 'Carrier matching could not finish. Use Refresh to try again.'
          : profile?.job?.state === 'complete' ? 'No carrier match yet.'
          : 'Checking carrier fit...'}</p>}
        </> : null}
        {tab === 'Sources' ? <>
          {google?.maps_url ? <a className="block text-cui-primary underline" href={google.maps_url} target="_blank" rel="noopener noreferrer">Google Maps listing</a> : null}
          {observations.map((item) => <div key={`${item.source}:${item.record_id}`} className="space-y-1">
            <a className="text-cui-primary underline" href={item.url} target="_blank" rel="noopener noreferrer">{sourceName(item.source)}</a>
            <p className="text-xs">Checked {new Date(item.fetched_at).toLocaleDateString()}</p>
            {item.source === 'osm' ? <p className="text-xs">© OpenStreetMap contributors · ODbL</p> : null}
          </div>)}
          {profile ? result?.coverage.map((item) => <SourceStatus key={item.source} source={item.source} label={sourceName(item.source)} profile={profile} />) : null}
        </> : null}
      </div>
    </> : target ? <WorkersCompPanel key={`${target.type}:${target.id}`} target={target} /> : null}
  </section>;
}
