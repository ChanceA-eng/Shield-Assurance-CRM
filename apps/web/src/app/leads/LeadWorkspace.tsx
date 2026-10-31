'use client';

import { useCallback, useEffect, useState } from 'react';
import { Landmark, Mail, Phone, Send, Sparkles, X } from 'lucide-react';
import type { FmcsaCandidate, FmcsaRecord, OshaRecord } from '../../lib/enrichment';
import { LEAD_STATUS_LABELS, type LeadStatus } from '../../lib/lead-pipeline';
import RecordAssetsPanel from '../../components/crm/RecordAssetsPanel';
import RecordWorkPanel from '../../components/crm/RecordWorkPanel';
import LeadAccountLink from '../../components/crm/LeadAccountLink';
import { INTAKE_QUEUE_CHANGED } from '../../components/layout/NewLeadBanner';
import { workspaceFetch } from '../../lib/workspace-fetch';

export interface WorkspaceLead {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  line_of_business?: string | null;
  source?: string | null;
  status: string;
  estimated_premium?: number | string | null;
  created_at: string;
  form_payload?: Record<string, unknown> | null;
  account_id?: string | null;
}

interface LeadWorkspaceProps {
  lead: WorkspaceLead;
  onClose: () => void;
  /** Called after any change that affects lists outside the drawer (tasks, premium, notes). */
  onChanged: () => void;
}

interface ConversationItem {
  id: string;
  channel?: string | null;
  direction?: string | null;
  subject?: string | null;
  body?: string | null;
  sent_at?: string | null;
  automation_type?: string | null;
}

interface ProfileRenewal {
  type?: string;
  date?: string;
  carrier?: string | null;
  broker?: string | null;
}

interface ProfileContact {
  name?: string;
  position?: string | null;
  email?: string | null;
  phone?: string | null;
}

function Field({ label, value }: { label: string; value: unknown }): JSX.Element | null {
  const str = value === null || value === undefined || value === '' ? null : String(value);
  if (!str) return null;
  return (
    <div className="text-sm">
      <span className="font-semibold text-cui-muted">{label}:</span> <span className="break-all">{str}</span>
    </div>
  );
}

function ProfileSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="rounded border border-cui-border/60">
      <div className="border-b border-cui-border/40 bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">{title}</div>
      <div className="space-y-1 p-3">{children}</div>
    </div>
  );
}

function ExtrasSection({ extras }: { extras: Record<string, unknown> }): JSX.Element | null {
  const entries = Object.entries(extras).filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (entries.length === 0) return null;
  return (
    <details open className="rounded border border-cui-border/60">
      <summary className="cursor-pointer border-b border-cui-border/40 bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">
        Additional Data ({entries.length})
      </summary>
      <table className="w-full text-left text-sm">
        <tbody>
          {entries.map(([key, value]) => (
            <tr key={key} className="border-t border-cui-light first:border-t-0">
              <td className="w-48 px-3 py-1.5 align-top font-semibold text-cui-muted">{key}</td>
              <td className="break-all px-3 py-1.5 text-cui-text">{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function money(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(String(value).replace(/[$,]/g, ''));
  if (!Number.isFinite(num)) return String(value);
  return `$${num.toLocaleString()}`;
}

interface CoverageLine {
  renewal?: string | null;
  participants?: string | null;
  carrier?: string | null;
  broker?: string | null;
}

function CoverageSection({ title, line }: { title: string; line: CoverageLine }): JSX.Element | null {
  if (!line.renewal && !line.carrier && !line.broker && !line.participants) return null;
  return (
    <ProfileSection title={title}>
      <Field label="Renewal" value={line.renewal} />
      <Field label="Participants" value={line.participants} />
      <Field label="Carrier" value={line.carrier} />
      <Field label="Broker" value={line.broker} />
    </ProfileSection>
  );
}

function EnrichmentSections({ profile }: { profile: Record<string, unknown> }): JSX.Element | null {
  const enrichment = (profile.enrichment ?? {}) as { fmcsa?: FmcsaRecord; osha?: OshaRecord };
  const fmcsa = enrichment.fmcsa;
  const osha = enrichment.osha;
  if (!fmcsa && !osha) return null;

  const oosLine = (rate: number | null, nationalAvg: string | null): string | null => {
    if (rate === null) return null;
    return nationalAvg ? `${rate}% (national avg ${nationalAvg}%)` : `${rate}%`;
  };

  return (
    <>
      {fmcsa ? (
        <ProfileSection title="DOT Safety Record (FMCSA)">
          <Field label="DOT number" value={fmcsa.dot_number} />
          <Field label="Legal name" value={fmcsa.dba_name ? `${fmcsa.legal_name} (DBA ${fmcsa.dba_name})` : fmcsa.legal_name} />
          <Field label="Operating status" value={fmcsa.operating_status} />
          <Field
            label="Safety rating"
            value={fmcsa.safety_rating ? [fmcsa.safety_rating, fmcsa.safety_rating_date].filter(Boolean).join(' · ') : 'None issued'}
          />
          <Field label="Power units" value={fmcsa.power_units} />
          <Field label="Drivers" value={fmcsa.drivers} />
          <Field label="Driver out-of-service rate" value={oosLine(fmcsa.driver_oos_rate, fmcsa.driver_oos_national_avg)} />
          <Field label="Vehicle out-of-service rate" value={oosLine(fmcsa.vehicle_oos_rate, fmcsa.vehicle_oos_national_avg)} />
          {fmcsa.crashes_total !== null ? (
            <Field
              label="Crashes (24 mo)"
              value={`${fmcsa.crashes_total} total · ${fmcsa.crashes_fatal ?? 0} fatal · ${fmcsa.crashes_injury ?? 0} injury · ${fmcsa.crashes_tow ?? 0} tow-away`}
            />
          ) : null}
          <Field label="Inspections (24 mo)" value={fmcsa.inspections_total} />
          <Field label="Physical address" value={fmcsa.physical_address} />
          <Field label="Retrieved" value={prettyDateTime(fmcsa.fetched_at)} />
        </ProfileSection>
      ) : null}

      {osha ? (
        <ProfileSection title={`OSHA Inspection History (${osha.total_inspections})`}>
          {osha.total_inspections === 0 ? (
            <p className="text-sm text-cui-muted">No federal OSHA inspections on record for this name and state.</p>
          ) : (
            <>
              <Field label="Total current penalties" value={money(osha.total_penalties)} />
              {osha.inspections.slice(0, 10).map((inspection) => {
                const violations = [
                  inspection.violations_serious ? `${inspection.violations_serious} serious` : null,
                  inspection.violations_willful ? `${inspection.violations_willful} willful` : null,
                  inspection.violations_repeat ? `${inspection.violations_repeat} repeat` : null,
                  inspection.violations_other ? `${inspection.violations_other} other` : null,
                ].filter(Boolean);
                return (
                  <div key={inspection.activity_nr} className="border-t border-cui-light pt-1.5 text-sm first:border-t-0 first:pt-0">
                    <p className="font-semibold text-cui-text">
                      {[inspection.open_date, inspection.inspection_type, inspection.case_status].filter(Boolean).join(' · ') || 'Inspection'}
                    </p>
                    <p className="text-xs text-cui-muted">
                      {[
                        [inspection.city, inspection.state].filter(Boolean).join(', ') || null,
                        violations.length > 0 ? violations.join(', ') : 'No violations recorded',
                        inspection.total_penalty ? `${money(inspection.total_penalty)} penalty` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                );
              })}
            </>
          )}
          <Field label="Retrieved" value={prettyDateTime(osha.fetched_at)} />
        </ProfileSection>
      ) : null}
    </>
  );
}

function StructuredProfile({ profile }: { profile: Record<string, unknown> }): JSX.Element | null {
  const kind = typeof profile.kind === 'string' ? profile.kind : 'generic';
  const extras = (profile.extras ?? {}) as Record<string, unknown>;

  if (kind === 'commercial') {
    const company = (profile.company ?? {}) as Record<string, unknown>;
    const contacts = Array.isArray(profile.contacts) ? (profile.contacts as ProfileContact[]) : [];
    const renewals = Array.isArray(profile.renewals) ? (profile.renewals as ProfileRenewal[]) : [];
    const risks = Array.isArray(profile.risk_signals) ? (profile.risk_signals as string[]) : [];
    const contractAwards = Array.isArray(profile.contract_awards) ? (profile.contract_awards as string[]) : [];
    const workersComp = (profile.workers_comp ?? {}) as CoverageLine;
    const pension = (profile.pension ?? {}) as CoverageLine;
    const benefits = (profile.benefits ?? {}) as CoverageLine;
    const liability = (profile.liability ?? {}) as Record<string, unknown>;
    const osha = (profile.osha ?? {}) as Record<string, unknown>;
    const dot = (profile.dot ?? {}) as Record<string, unknown>;
    const dotSignals = Array.isArray(dot.signals) ? (dot.signals as string[]) : [];
    const fin990 = (profile.financials_990 ?? {}) as Record<string, unknown>;
    const dotLine = (bucket: unknown): string | null => {
      const item = (bucket ?? {}) as Record<string, unknown>;
      const parts = [item.xdate, item.carrier].filter((v) => typeof v === 'string' && v);
      return parts.length > 0 ? parts.join(' · ') : null;
    };
    const hasDot = Boolean(
      dot.units || dot.drivers || dot.violations || dot.intrastate || dot.interstate ||
      dotLine(dot.bipd_primary) || dotLine(dot.bipd_excess) || dotLine(dot.cargo) || dotLine(dot.surety) || dotSignals.length > 0,
    );
    const has990 = Boolean(fin990.revenue || fin990.expenses || fin990.net_assets || fin990.insurance_expenses || fin990.report_type);

    return (
      <div className="space-y-4">
        <ProfileSection title="Company">
          <Field label="Industry" value={company.industry} />
          <Field label="NAICS" value={company.naics} />
          <Field label="NAICS list" value={company.naics_list} />
          <Field label="Sales range" value={company.sales_range} />
          <Field label="Employees" value={company.employees} />
          <Field label="EIN" value={company.ein} />
          <Field label="Website" value={company.website} />
          <Field label="LinkedIn" value={company.linkedin} />
          <Field label="HQ phone" value={company.hq_phone} />
        </ProfileSection>

        {contacts.length > 0 ? (
          <ProfileSection title={`Contacts (${contacts.length})`}>
            {contacts.map((contact, index) => (
              <div key={`${contact.name}-${index}`} className="rounded bg-cui-light/60 px-2.5 py-1.5 text-sm">
                <p className="font-semibold text-cui-text">
                  {contact.name}
                  {contact.position ? <span className="font-normal text-cui-muted"> — {contact.position}</span> : null}
                </p>
                <p className="text-xs text-cui-muted">{[contact.phone, contact.email].filter(Boolean).join(' · ') || '--'}</p>
              </div>
            ))}
          </ProfileSection>
        ) : null}

        {renewals.length > 0 ? (
          <ProfileSection title="Renewal Calendar">
            {renewals.map((renewal, index) => (
              <div key={`${renewal.type}-${index}`} className="flex items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-cui-text">{renewal.type}</span>
                <span className="text-cui-muted">
                  {renewal.date}
                  {renewal.carrier ? ` · ${renewal.carrier}` : ''}
                </span>
              </div>
            ))}
          </ProfileSection>
        ) : null}

        <CoverageSection title="Workers Comp" line={workersComp} />
        <CoverageSection title="Pension" line={pension} />
        <CoverageSection title="Benefits" line={benefits} />

        {liability.gl_xdate || liability.commercial_auto_xdate || liability.fidelity_bond ? (
          <ProfileSection title="Liability">
            <Field label="GL X-date (predicted)" value={liability.gl_xdate} />
            <Field label="Commercial Auto X-date (predicted)" value={liability.commercial_auto_xdate} />
            <Field label="Fidelity bond" value={money(liability.fidelity_bond)} />
          </ProfileSection>
        ) : null}

        {osha.safety_violations || osha.health_violations ? (
          <ProfileSection title="OSHA">
            <Field label="Safety violations" value={osha.safety_violations} />
            <Field label="Health violations" value={osha.health_violations} />
          </ProfileSection>
        ) : null}

        {hasDot ? (
          <ProfileSection title="DOT / Fleet">
            <Field label="Units" value={dot.units} />
            <Field label="Drivers" value={dot.drivers} />
            <Field label="Violations" value={dot.violations} />
            <Field label="Intrastate" value={dot.intrastate} />
            <Field label="Interstate" value={dot.interstate} />
            <Field label="BIPD Primary" value={dotLine(dot.bipd_primary)} />
            <Field label="BIPD Excess" value={dotLine(dot.bipd_excess)} />
            <Field label="Cargo" value={dotLine(dot.cargo)} />
            <Field label="Surety" value={dotLine(dot.surety)} />
            {dotSignals.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-cui-text">
                {dotSignals.map((signal, index) => (
                  <li key={index}>{signal}</li>
                ))}
              </ul>
            ) : null}
          </ProfileSection>
        ) : null}

        {has990 ? (
          <ProfileSection title="990 Financials">
            <Field label="Report" value={[fin990.report_type, fin990.report_year].filter(Boolean).join(' · ')} />
            <Field label="Revenue" value={money(fin990.revenue)} />
            <Field label="Expenses" value={money(fin990.expenses)} />
            <Field label="Net assets" value={money(fin990.net_assets)} />
            <Field label="Insurance spend" value={money(fin990.insurance_expenses)} />
          </ProfileSection>
        ) : null}

        {contractAwards.length > 0 ? (
          <ProfileSection title={`Government Contract Awards (${contractAwards.length})`}>
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-cui-text">
              {contractAwards.map((award, index) => (
                <li key={index} className="break-all">{award}</li>
              ))}
            </ul>
          </ProfileSection>
        ) : null}

        {risks.length > 0 ? (
          <ProfileSection title="Risk Signals">
            <ul className="list-disc space-y-0.5 pl-4 text-sm text-cui-text">
              {risks.map((risk, index) => (
                <li key={index}>{risk}</li>
              ))}
            </ul>
          </ProfileSection>
        ) : null}

        <EnrichmentSections profile={profile} />

        <ExtrasSection extras={extras} />
      </div>
    );
  }

  if (kind === 'personal_auto') {
    const demographics = (profile.demographics ?? {}) as Record<string, unknown>;
    const vehicles = Array.isArray(profile.vehicles) ? (profile.vehicles as Array<Record<string, unknown>>) : [];
    const compliance = (profile.compliance ?? {}) as Record<string, unknown>;

    return (
      <div className="space-y-4">
        <ProfileSection title="Applicant">
          <Field label="DOB" value={demographics.dob} />
          <Field label="Gender" value={demographics.gender} />
          <Field label="Marital status" value={demographics.marital_status} />
          <Field label="Homeowner" value={demographics.homeowner === 'Y' ? 'Yes — bundle opportunity' : demographics.homeowner} />
        </ProfileSection>

        {vehicles.length > 0 ? (
          <ProfileSection title="Vehicles">
            {vehicles.map((vehicle, index) => (
              <div key={index} className="text-sm text-cui-text">
                <p className="font-semibold">
                  {[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'}
                </p>
                <p className="text-xs text-cui-muted">
                  {[
                    vehicle.annual_mileage ? `${vehicle.annual_mileage} mi/yr` : null,
                    vehicle.ownership,
                    vehicle.main_use,
                  ]
                    .filter(Boolean)
                    .join(' · ') || '--'}
                </p>
              </div>
            ))}
          </ProfileSection>
        ) : null}

        <ProfileSection title="Coverage">
          <Field label="Requested coverage" value={profile.coverage} />
          <Field label="Current carrier" value={profile.current_carrier} />
        </ProfileSection>

        {(() => {
          const alternates = (profile.alternate_contacts ?? {}) as Record<string, unknown>;
          const recent = Array.isArray(alternates.recent_emails) ? (alternates.recent_emails as string[]) : [];
          if (!alternates.landline && !alternates.cell && recent.length === 0) return null;
          return (
            <ProfileSection title="Alternate Contact Info">
              <Field label="Landline" value={alternates.landline} />
              <Field label="Cell" value={alternates.cell} />
              <Field label="Other emails" value={recent.join(', ') || null} />
            </ProfileSection>
          );
        })()}

        <ProfileSection title="Compliance (TCPA)">
          <Field label="Jornaya Lead ID" value={compliance.jornaya_lead_id} />
          <Field label="TrustedForm" value={compliance.trusted_form} />
          <Field label="Requested" value={compliance.requested_at} />
          <Field label="IP" value={compliance.ip_address} />
          <Field label="Vendor lead ID" value={compliance.vendor_lead_id} />
        </ProfileSection>

        <ExtrasSection extras={extras} />
      </div>
    );
  }

  return (
    <>
      <EnrichmentSections profile={profile} />
      <ExtrasSection extras={extras} />
    </>
  );
}

type DrawerTab = 'overview' | 'assets' | 'notes' | 'conversation' | 'tasks';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fullDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Renders a freeform text blob as readable Q&A: lines shaped like
 * "Question: answer" get a bold label and highlighted answer; raw JSON
 * fragments are dropped; everything else stays as plain text.
 */
function AnswerLines({ text }: { text: string }): JSX.Element | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // JSON fragments are machine noise; the structured sections cover that data.
    .filter((line) => !/[:=]\s*[{[]/.test(line) && !line.startsWith('{') && !line.startsWith('['));
  if (lines.length === 0) {
    // Everything was machine noise — show the raw text rather than nothing.
    return <p className="whitespace-pre-wrap break-all text-sm text-cui-text">{text}</p>;
  }

  return (
    <div className="space-y-1">
      {lines.map((line, index) => {
        const match = line.match(/^([^:]{2,64}):\s*(.+)$/);
        if (match) {
          return (
            <div key={index} className="text-sm">
              <span className="font-semibold text-cui-muted">{match[1].trim()}:</span>{' '}
              <span className="rounded bg-cui-warning/15 px-1 font-medium text-cui-text">{match[2].trim()}</span>
            </div>
          );
        }
        return (
          <p key={index} className="text-sm font-semibold text-cui-text">
            {line.replace(/:$/, '')}
          </p>
        );
      })}
    </div>
  );
}

/** Paths already rendered by the structured website sections. */
const WEBSITE_RENDERED_PATHS = new Set([
  'id',
  'email',
  'phone',
  'name',
  'fullName',
  'full_name',
  'client_name',
  'source_page',
  'risk_details',
  'message',
  'details',
  'requirements',
  'created_at',
  'status',
  'source',
  'from',
  'line',
  'insurance_line',
  'intake_route',
  'ai_status',
  'producer_id',
  'submission_id',
  'submission_date',
  'submitted_at',
  'line_of_business',
  'needs_enrichment',
  'previous_submissions',
  'metadata.submittedAt',
  'metadata.page',
  'metadata.zip',
  'metadata.businessName',
  'metadata.preferredContactMethod',
  'metadata.guide.label',
  'metadata.guide.category',
  'metadata.guide.tier',
  'metadata.guide.message',
  'metadata.guide.summary',
  'metadata.assets.auto.year',
  'metadata.assets.auto.make',
  'metadata.assets.auto.model',
  'metadata.assets.auto.vin',
  'metadata.assets.home.address',
  'metadata.assets.business.industry',
  'metadata.assets.bundleSelections',
  'metadata.routing.fullName',
  'metadata.routing.email',
  'metadata.routing.phone',
  'metadata.routing.zipCode',
  'metadata.routingContext.sourceChannel',
  'metadata.routingContext.priorityTier',
]);

/**
 * Whole subtrees that only duplicate the Q&A already shown in
 * "What They Asked For" (the website mirrors answers as key-value maps).
 */
const WEBSITE_SKIPPED_SUBTREES = [
  '_intake',
  'metadata.businessReview',
  'lead_context',
  'metadata.notification',
  'metadata.contactConsent',
];

/** Flattens every leaf value not already shown, so no submitted data is hidden. */
function collectRemainingData(value: unknown, path: string, out: Array<[string, string]>): void {
  if (WEBSITE_RENDERED_PATHS.has(path)) return;
  if (WEBSITE_SKIPPED_SUBTREES.some((subtree) => path === subtree || path.startsWith(`${subtree}.`))) return;
  if (value === null || value === undefined || value === '') return;
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      const joined = value.map((item) => String(item)).filter(Boolean).join(', ');
      if (joined) out.push([path, joined]);
      return;
    }
    value.forEach((item, index) => collectRemainingData(item, `${path}[${index + 1}]`, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectRemainingData(child, path ? `${path}.${key}` : key, out);
    }
    return;
  }
  if (typeof value === 'boolean') {
    out.push([path, value ? 'Yes' : 'No']);
    return;
  }
  out.push([path, String(value)]);
}

function pathLabel(path: string): string {
  return path
    .split('.')
    .map((segment) => humanizeKey(segment))
    .join(' · ');
}

/** Structured view of a website quote-request submission. */
function WebsiteSubmission({ payload }: { payload: Record<string, unknown> }): JSX.Element {
  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const guide = isRecord(metadata.guide) ? metadata.guide : {};
  const assets = isRecord(metadata.assets) ? metadata.assets : {};
  const routing = isRecord(metadata.routing) ? metadata.routing : {};
  const routingContext = isRecord(metadata.routingContext) ? metadata.routingContext : {};
  const auto = isRecord(assets.auto) ? assets.auto : {};
  const home = isRecord(assets.home) ? assets.home : {};
  const business = isRecord(assets.business) ? assets.business : {};

  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
  const consent = isRecord(metadata.contactConsent) ? metadata.contactConsent : {};
  const businessReview = isRecord(metadata.businessReview) ? metadata.businessReview : {};
  const submittedAt = fullDateTime(
    text(metadata.submittedAt) ??
      text(payload.submission_date as string) ??
      text(consent.recordedAt) ??
      text(payload.created_at as string),
  );

  const requested =
    [text(guide.label) ?? text(guide.category), text(guide.tier)].filter(Boolean).join(' · ') ||
    text(payload.insurance_line as string) ||
    text(payload.line as string) ||
    '';
  const bundles = Array.isArray(assets.bundleSelections)
    ? (assets.bundleSelections as unknown[]).map((item) => String(item)).filter(Boolean)
    : [];

  const vehicle = [text(auto.year), text(auto.make), text(auto.model)].filter(Boolean).join(' ');
  // The Q&A text lives in different fields depending on which website form was used.
  const answersText =
    text(guide.message) ??
    text(payload.message as string) ??
    text(payload.risk_details as string) ??
    text(payload.details as string) ??
    text(payload.requirements as string);

  const previousSubmissions = Array.isArray(payload.previous_submissions)
    ? (payload.previous_submissions as Array<Record<string, unknown>>)
    : [];

  const remaining: Array<[string, string]> = [];
  collectRemainingData(payload, '', remaining);

  return (
    <div className="space-y-4">
      <ProfileSection title={previousSubmissions.length > 0 ? 'Latest Website Submission' : 'Website Submission'}>
        <Field label="Submitted" value={submittedAt} />
        <Field label="Requested" value={requested ? humanizeKey(requested) : null} />
        <Field label="Priority" value={text(routingContext.priorityTier) ? humanizeKey(String(routingContext.priorityTier)) : null} />
        <Field
          label="From"
          value={text(routingContext.sourceChannel) ?? text(payload.source_page as string) ?? text(payload.from as string) ?? text(metadata.page)}
        />
        <Field label="Business name" value={text(metadata.businessName)} />
        <Field
          label="Industry"
          value={text(businessReview.industry) ? humanizeKey(String(businessReview.industry)) : null}
        />
        <Field label="What they do" value={text(businessReview.activity)} />
        <Field
          label="Preferred contact"
          value={text(metadata.preferredContactMethod) ? humanizeKey(String(metadata.preferredContactMethod)) : null}
        />
        {bundles.length > 0 ? <Field label="Also interested in" value={bundles.join(', ')} /> : null}
      </ProfileSection>

      {answersText ? (
        <ProfileSection title="What They Asked For">
          <AnswerLines text={answersText} />
        </ProfileSection>
      ) : null}

      {vehicle || text(auto.vin) || text(home.address) || text(business.industry) ? (
        <ProfileSection title="Assets Mentioned">
          <Field label="Vehicle" value={vehicle || null} />
          <Field label="VIN" value={text(auto.vin)} />
          <Field label="Home address" value={text(home.address)} />
          <Field label="Business industry" value={text(business.industry)} />
        </ProfileSection>
      ) : null}

      <ProfileSection title="Contact Provided">
        <Field
          label="Name"
          value={
            text(routing.fullName) ??
            text(payload.client_name as string) ??
            text(payload.fullName as string) ??
            text(payload.name as string)
          }
        />
        <Field label="Email" value={text(routing.email) ?? text(payload.email as string)} />
        <Field label="Phone" value={formatPhone(text(routing.phone) ?? text(payload.phone as string))} />
        <Field label="ZIP" value={text(routing.zipCode) ?? text(metadata.zip)} />
        {consent.accepted === true ? (
          <Field label="Contact consent" value={`Accepted${text(consent.recordedAt) ? ` — ${fullDateTime(String(consent.recordedAt))}` : ''}`} />
        ) : null}
      </ProfileSection>

      {previousSubmissions.length > 0 ? (
        <details className="rounded border border-cui-border/60">
          <summary className="cursor-pointer border-b border-cui-border/40 bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">
            Previous Submissions ({previousSubmissions.length})
          </summary>
          <div className="space-y-3 p-3">
            {[...previousSubmissions].reverse().map((prev, index) => {
              const prevMeta = isRecord(prev.metadata) ? prev.metadata : {};
              const prevGuide = isRecord(prevMeta.guide) ? prevMeta.guide : {};
              const prevText =
                (typeof prevGuide.message === 'string' && prevGuide.message.trim()) ||
                (typeof prev.message === 'string' && prev.message.trim()) ||
                (typeof prev.risk_details === 'string' && prev.risk_details.trim()) ||
                (typeof prev.details === 'string' && prev.details.trim()) ||
                null;
              const when =
                fullDateTime(typeof prevMeta.submittedAt === 'string' ? prevMeta.submittedAt : null) ??
                fullDateTime(typeof prev.submission_date === 'string' ? prev.submission_date : null) ??
                fullDateTime(typeof prev.created_at === 'string' ? prev.created_at : null);
              return (
                <div key={index} className="rounded border border-cui-border/40 p-2.5">
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-cui-muted">{when ?? `Submission ${previousSubmissions.length - index}`}</p>
                  {prevText ? <AnswerLines text={prevText} /> : <p className="text-sm text-cui-muted">No details captured.</p>}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {remaining.length > 0 ? (
        <details className="rounded border border-cui-border/60">
          <summary className="cursor-pointer border-b border-cui-border/40 bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">
            Additional Details ({remaining.length})
          </summary>
          <table className="w-full text-left text-sm">
            <tbody>
              {remaining.map(([path, value]) => (
                <tr key={path} className="border-t border-cui-light first:border-t-0">
                  <td className="w-56 px-3 py-1.5 align-top font-semibold text-cui-muted">{pathLabel(path)}</td>
                  <td className="break-all px-3 py-1.5 font-medium text-cui-text">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}

/** snake_case / camelCase keys become readable labels. */
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Displays US phone numbers as (xxx) xxx-xxxx regardless of stored format. */
function formatPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  const core = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (core.length !== 10) return value;
  return `(${core.slice(0, 3)}) ${core.slice(3, 6)}-${core.slice(6)}`;
}

function renderPayloadValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => renderPayloadValue(item)).join(', ');
  if (value === null || typeof value === 'undefined') return '--';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function prettyDateTime(value: string | null | undefined): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function statusBadgeTone(status: string): string {
  if (status === 'won') return 'bg-cui-success/15 text-cui-success';
  if (status === 'lost') return 'bg-cui-danger/15 text-cui-danger';
  if (status === 'quoted') return 'bg-cui-warning/20 text-amber-700';
  if (status === 'contacted') return 'bg-cui-primary/15 text-cui-primary';
  if (status === 'inactive') return 'bg-cui-light text-cui-muted';
  return 'bg-cui-info/15 text-cui-info';
}

export default function LeadWorkspace({ lead: initialLead, onClose, onChanged }: LeadWorkspaceProps): JSX.Element {
  const [lead, setLead] = useState(initialLead);
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [error, setError] = useState<string | null>(null);

  // Quick edit: premium + contact info
  const [premiumDraft, setPremiumDraft] = useState<string>(() => {
    const value = toNumber(lead.estimated_premium);
    return value > 0 ? String(value) : '';
  });
  const [nameDraft, setNameDraft] = useState<string>(lead.full_name ?? '');
  const [addressDraft, setAddressDraft] = useState<string>(lead.address ?? '');
  const [phoneDraft, setPhoneDraft] = useState<string>(lead.phone ?? '');
  const [emailDraft, setEmailDraft] = useState<string>(lead.email ?? '');
  const [isSavingPremium, setIsSavingPremium] = useState(false);

  const [openTaskCount, setOpenTaskCount] = useState(0);
  const [compose, setCompose] = useState<{ kind: 'note' | 'reminder'; token: number }>();
  const [assetComposeToken, setAssetComposeToken] = useState(0);
  const [recordRefreshToken, setRecordRefreshToken] = useState(0);
  const [intakeIds, setIntakeIds] = useState<string[]>([]);

  // Conversation tab
  const [conversation, setConversation] = useState<ConversationItem[]>([]);
  const [clientId, setClientId] = useState<string | null>(lead.account_id ?? null);
  const [isLoadingConversation, setIsLoadingConversation] = useState(false);
  const [channel, setChannel] = useState<'email' | 'sms'>('email');
  const [subjectDraft, setSubjectDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isDrafting, setIsDrafting] = useState(false);
  const [citedSignals, setCitedSignals] = useState<string[]>([]);

  // Pre-call talking points (Overview tab)
  const [talkingPoints, setTalkingPoints] = useState<string[] | null>(null);
  const [isLoadingPoints, setIsLoadingPoints] = useState(false);

  // Public-records enrichment (Overview tab)
  const [enrichingSource, setEnrichingSource] = useState<'fmcsa' | 'osha' | null>(null);
  const [fmcsaCandidates, setFmcsaCandidates] = useState<FmcsaCandidate[] | null>(null);
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null);

  // Outreach sequence (Overview tab)
  const [sequence, setSequence] = useState<{
    id: string;
    status: string;
    current_step: number;
    total_steps: number;
    next_send_at: string | null;
  } | null>(null);
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [sequenceNotice, setSequenceNotice] = useState<string | null>(null);

  // Full record (the list omits heavy vendor payloads for speed).
  const [fullPayload, setFullPayload] = useState<Record<string, unknown> | null>(lead.form_payload ?? null);

  const loadFullPayload = useCallback(async (): Promise<void> => {
    try {
      const detail = await workspaceFetch<WorkspaceLead & { intake_event_ids: string[] }>(`/api/leads/${encodeURIComponent(lead.id)}`);
      setLead(detail);
      setFullPayload(detail.form_payload ?? null);
      setClientId(detail.account_id ?? null);
      setIntakeIds(detail.intake_event_ids);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to load the full lead profile.');
    }
  }, [lead.id]);

  useEffect(() => {
    void loadFullPayload();
  }, [loadFullPayload]);

  useEffect(() => {
    if (!intakeIds.length) return;
    void workspaceFetch('/api/leads/attention', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: intakeIds, action: 'opened' }),
    }).then(() => {
      window.dispatchEvent(new Event(INTAKE_QUEUE_CHANGED));
    }).catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'The profile opened, but the intake queue could not be acknowledged.');
    });
  }, [intakeIds]);

  const onAccountLinked = useCallback((id: string): void => {
    setClientId(id);
    setRecordRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/outreach/enroll?lead_id=${encodeURIComponent(lead.id)}`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const payload = (await res.json()) as { enrollment: typeof sequence };
        if (!cancelled) setSequence(payload.enrollment);
      } catch {
        // Sequence status is non-critical.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  const enrollInSequence = async (): Promise<void> => {
    setIsEnrolling(true);
    setSequenceNotice(null);
    try {
      const res = await fetch('/api/outreach/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        enrollment?: { id: string; status: string; current_step: number; total_steps: number; next_send_at: string | null };
        message?: string;
      };
      if (!res.ok || !payload.enrollment) {
        setSequenceNotice(payload.message ?? 'Enrollment failed.');
        return;
      }
      setSequence(payload.enrollment);
      setSequenceNotice(payload.message ?? 'Enrolled.');
    } catch {
      setSequenceNotice('Enrollment failed.');
    } finally {
      setIsEnrolling(false);
    }
  };

  const loadConversation = useCallback(async (): Promise<void> => {
    setIsLoadingConversation(true);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/conversation`, { cache: 'no-store' });
      if (!res.ok) {
        setConversation([]);
        setClientId(null);
        return;
      }
      const payload = (await res.json()) as { clientId: string | null; items: ConversationItem[] };
      setClientId(payload.clientId);
      setConversation(payload.items);

      // Viewing the conversation marks inbound messages as read.
      if (payload.clientId && payload.items.some((item) => (item.direction ?? '') === 'inbound')) {
        void fetch('/api/communication-log/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: payload.clientId }),
        }).then(() => onChanged());
      }
    } catch {
      setConversation([]);
      setClientId(null);
    } finally {
      setIsLoadingConversation(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead.id]);

  useEffect(() => {
    void loadConversation();
  }, [loadConversation, recordRefreshToken]);

  const savePremium = async (): Promise<void> => {
    setIsSavingPremium(true);
    setError(null);
    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: lead.id,
          estimated_premium: premiumDraft || '0',
          full_name: nameDraft.trim() || lead.full_name,
          address: addressDraft.trim(),
          phone: phoneDraft.trim(),
          email: emailDraft.trim().toLowerCase(),
        }),
      });
      if (!res.ok) {
        const failure = (await res.json()) as { message?: string };
        setError(failure.message || 'Failed to save changes.');
        return;
      }
      const updated = (await res.json()) as WorkspaceLead;
      setLead(updated);
      onChanged();
    } catch {
      setError('Failed to save changes.');
    } finally {
      setIsSavingPremium(false);
    }
  };

  const draftWithAi = async (): Promise<void> => {
    setIsDrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/draft-outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'draft', instruction: bodyDraft.trim() || undefined }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        subject?: string;
        body?: string;
        cited_signals?: string[];
        message?: string;
      };
      if (!res.ok || !payload.body) {
        setError(payload.message ?? 'Drafting is unavailable right now.');
        return;
      }
      setSubjectDraft(payload.subject ?? '');
      setBodyDraft(payload.body);
      setCitedSignals(payload.cited_signals ?? []);
      setChannel('email');
    } catch {
      setError('Drafting is unavailable right now.');
    } finally {
      setIsDrafting(false);
    }
  };

  const loadTalkingPoints = async (): Promise<void> => {
    setIsLoadingPoints(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/draft-outreach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'talking_points' }),
      });
      const payload = (await res.json().catch(() => ({}))) as { points?: string[]; message?: string };
      if (!res.ok || !Array.isArray(payload.points)) {
        setError(payload.message ?? 'Talking points are unavailable right now.');
        return;
      }
      setTalkingPoints(payload.points);
    } catch {
      setError('Talking points are unavailable right now.');
    } finally {
      setIsLoadingPoints(false);
    }
  };

  const sendMessage = async (): Promise<void> => {
    const body = bodyDraft.trim();
    if (!body) return;
    if (channel === 'email' && !lead.email) {
      setError('This lead has no email address on file.');
      return;
    }

    setIsSending(true);
    setError(null);
    try {
      // Ensure a client record exists so the conversation lands on the lifecycle record.
      let targetClientId = clientId;
      if (!targetClientId) {
        const workspaceRes = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/workspace`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ create: true }),
        });
        if (!workspaceRes.ok) {
          setError('Could not link this lead to a client record.');
          return;
        }
        const workspacePayload = (await workspaceRes.json()) as { clientId: string };
        targetClientId = workspacePayload.clientId;
        setClientId(targetClientId);
      }

      const res = await fetch('/api/communication-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: targetClientId,
          channel,
          direction: 'outbound',
          subject: channel === 'email' ? subjectDraft.trim() || `Message from Shield Assurance` : undefined,
          body,
          automation_type: 'manual',
          to: channel === 'email' ? lead.email : undefined,
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({ message: 'Failed to send message.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to send message.');
        return;
      }

      setBodyDraft('');
      setSubjectDraft('');
      await loadConversation();
      onChanged();
    } catch {
      setError('Failed to send message.');
    } finally {
      setIsSending(false);
    }
  };

  const runEnrichment = async (source: 'fmcsa' | 'osha', dotNumber?: string): Promise<void> => {
    setEnrichingSource(source);
    setEnrichMessage(null);
    if (source === 'fmcsa' && !dotNumber) setFmcsaCandidates(null);
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(lead.id)}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, dot_number: dotNumber }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        saved?: boolean;
        candidates?: FmcsaCandidate[];
        message?: string;
      };
      if (!res.ok) {
        setEnrichMessage(payload.message ?? 'Lookup failed. Please try again.');
        return;
      }
      if (payload.saved) {
        setFmcsaCandidates(null);
        setEnrichMessage(source === 'fmcsa' ? 'DOT safety record saved to this profile.' : 'OSHA history saved to this profile.');
        await loadFullPayload();
        return;
      }
      if (Array.isArray(payload.candidates) && payload.candidates.length > 0) {
        setFmcsaCandidates(payload.candidates);
        setEnrichMessage('Multiple carriers matched — pick the right one below.');
        return;
      }
      setEnrichMessage(payload.message ?? 'No match found.');
    } catch {
      setEnrichMessage('Lookup failed. Please try again.');
    } finally {
      setEnrichingSource(null);
    }
  };

  const structuredProfile = isRecord(fullPayload?.profile) ? fullPayload.profile : null;
  // Website quote requests carry a routing/metadata envelope instead of a vendor profile.
  const websitePayload =
    !structuredProfile &&
    fullPayload &&
    (isRecord(fullPayload.metadata) || typeof fullPayload.intake_route === 'string' || typeof fullPayload.client_name === 'string')
      ? fullPayload
      : null;
  const payloadEntries = fullPayload
    ? Object.entries(fullPayload).filter(([key]) => !['_request', 'profile', 'import', 'repaired_at', 'row', 'merged_from'].includes(key))
    : [];
  const requestContext = fullPayload && isRecord(fullPayload._request) ? fullPayload._request : null;

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/40">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-panel">
        {/* Header */}
        <div className="shrink-0 border-b border-cui-border/60 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="truncate text-lg font-bold text-cui-text">{lead.full_name}</h2>
                <span className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${statusBadgeTone(lead.status)}`}>
                  {LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-cui-muted">
                {lead.line_of_business || 'No line of business'} · {lead.source || 'unknown source'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {lead.phone ? (
                <a href={`tel:${lead.phone}`} className="rounded border border-cui-border/60 p-1.5 text-cui-muted hover:bg-cui-light hover:text-cui-primary" title={`Call ${lead.phone}`}>
                  <Phone className="h-4 w-4" />
                </a>
              ) : null}
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="rounded border border-cui-border/60 p-1.5 text-cui-muted hover:bg-cui-light hover:text-cui-primary" title={`Email ${lead.email}`}>
                  <Mail className="h-4 w-4" />
                </a>
              ) : null}
              <button type="button" onClick={onClose} className="rounded border border-cui-border/60 p-1.5 text-cui-muted hover:bg-cui-light hover:text-cui-text" aria-label="Close workspace">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Quick edit: identity + contact + premium (fix anything a client corrects on a call) */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              placeholder="Name"
              title="Legal or preferred name — edit if the client corrects it"
              className="w-48 rounded border border-cui-border px-2 py-1 text-sm"
            />
            <input
              type="tel"
              value={phoneDraft}
              onChange={(event) => setPhoneDraft(event.target.value)}
              placeholder="Phone"
              className="w-36 rounded border border-cui-border px-2 py-1 text-sm"
            />
            <input
              type="email"
              value={emailDraft}
              onChange={(event) => setEmailDraft(event.target.value)}
              placeholder="Email"
              className="w-52 rounded border border-cui-border px-2 py-1 text-sm"
            />
            <input
              type="text"
              value={addressDraft}
              onChange={(event) => setAddressDraft(event.target.value)}
              placeholder="Address"
              title="Street, city, state, ZIP"
              className="w-72 min-w-48 flex-1 rounded border border-cui-border px-2 py-1 text-sm"
            />
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold text-cui-muted">$</span>
              <input
                type="number"
                min="0"
                step="50"
                value={premiumDraft}
                onChange={(event) => setPremiumDraft(event.target.value)}
                placeholder="Premium"
                className="w-24 rounded border border-cui-border px-2 py-1 text-sm"
              />
            </div>
            <button
              type="button"
              onClick={() => void savePremium()}
              disabled={isSavingPremium}
              className="rounded bg-cui-primary px-2.5 py-1 text-xs font-semibold text-white hover:brightness-95 disabled:opacity-60"
            >
              {isSavingPremium ? 'Saving…' : 'Save'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setTab('notes'); setCompose((value) => ({ kind: 'note', token: (value?.token ?? 0) + 1 })); }}
              className="rounded border border-cui-primary px-2.5 py-1 text-xs font-semibold text-cui-primary">Add note</button>
            <button type="button" onClick={() => { setTab('tasks'); setCompose((value) => ({ kind: 'reminder', token: (value?.token ?? 0) + 1 })); }}
              className="rounded border border-cui-primary px-2.5 py-1 text-xs font-semibold text-cui-primary">Add reminder</button>
            <button type="button" onClick={() => { setTab('assets'); setAssetComposeToken((value) => value + 1); }}
              className="rounded border border-cui-primary px-2.5 py-1 text-xs font-semibold text-cui-primary">Add asset</button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {(
              [
                ['overview', 'Overview'],
                ['assets', 'Assets'],
                ['notes', 'Notes'],
                ['conversation', 'Conversation'],
                ['tasks', `Tasks (${openTaskCount})`],
              ] as Array<[DrawerTab, string]>
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-t border-b-2 px-3 py-1.5 text-sm font-semibold transition ${
                  tab === key ? 'border-cui-primary text-cui-primary' : 'border-transparent text-cui-muted hover:text-cui-text'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="mx-4 mt-3 shrink-0 rounded border border-cui-danger/40 bg-cui-danger/10 px-3 py-2 text-sm text-cui-danger">
            {error}
          </div>
        ) : null}

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === 'overview' ? (
            <div className="space-y-4">
              <div className="grid gap-2 text-sm md:grid-cols-2">
                <div><span className="font-semibold text-cui-muted">Phone:</span> {formatPhone(lead.phone) || '--'}</div>
                <div className="break-all"><span className="font-semibold text-cui-muted">Email:</span> {lead.email || '--'}</div>
                <div className="md:col-span-2"><span className="font-semibold text-cui-muted">Address:</span> {lead.address || '--'}</div>
                <div><span className="font-semibold text-cui-muted">Created:</span> {prettyDateTime(lead.created_at)}</div>
                <div><span className="font-semibold text-cui-muted">Account:</span> {clientId ? 'Linked' : 'Not linked'}</div>
              </div>
              <LeadAccountLink leadId={lead.id} onLinked={onAccountLinked} />

              {/* Pre-call prep */}
              <div className="rounded border border-cui-primary/30">
                <div className="flex items-center justify-between border-b border-cui-primary/20 bg-cui-primary/5 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-cui-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    Call Prep
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadTalkingPoints()}
                    disabled={isLoadingPoints}
                    className="text-xs font-semibold text-cui-primary hover:underline disabled:opacity-60"
                  >
                    {isLoadingPoints ? 'Preparing…' : talkingPoints ? 'Refresh' : 'Generate talking points'}
                  </button>
                </div>
                {talkingPoints ? (
                  <ul className="list-disc space-y-1 py-2 pl-7 pr-3 text-sm text-cui-text">
                    {talkingPoints.map((point, index) => (
                      <li key={index}>{point}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-3 py-2 text-xs text-cui-muted">
                    Generate conversation starters and risk observations from this lead&rsquo;s profile before you call.
                  </p>
                )}
              </div>

              {/* Outreach sequence */}
              <div className="rounded border border-cui-border/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cui-border/40 bg-cui-light px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-cui-muted">
                    <Mail className="h-3.5 w-3.5" />
                    Email Sequence
                  </p>
                  {!sequence || ['replied', 'completed', 'cancelled'].includes(sequence.status) ? (
                    <button
                      type="button"
                      onClick={() => void enrollInSequence()}
                      disabled={isEnrolling || !lead.email}
                      className="rounded bg-cui-primary px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-cui-primary/90 disabled:opacity-60"
                    >
                      {isEnrolling ? 'Enrolling…' : sequence ? 'Start a new sequence' : 'Start email sequence'}
                    </button>
                  ) : (
                    <a href="/outreach" className="text-xs font-semibold text-cui-primary hover:underline">
                      Manage in Outreach
                    </a>
                  )}
                </div>
                <p className="px-3 py-2 text-xs text-cui-muted">
                  {sequenceNotice
                    ? sequenceNotice
                    : sequence
                      ? sequence.status === 'active'
                        ? `Active — ${sequence.current_step} of ${sequence.total_steps} emails sent${sequence.next_send_at ? `, next ${prettyDateTime(sequence.next_send_at)}` : ''}.`
                        : sequence.status === 'paused'
                          ? 'Paused — resume it from the Outreach page.'
                          : sequence.status === 'replied'
                            ? 'They replied — sequence stopped, follow up personally.'
                            : sequence.status === 'opted_out'
                              ? 'This address opted out of outreach emails.'
                              : `Sequence ${sequence.status}.`
                      : lead.email
                        ? 'Enroll to send a short series of fact-grounded emails. Drafts wait for your approval; a reply stops everything.'
                        : 'Add an email address to enroll this lead in a sequence.'}
                </p>
              </div>

              {structuredProfile ? <StructuredProfile profile={structuredProfile} /> : null}

              {/* Public-records enrichment */}
              <div className="rounded border border-cui-border/60">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cui-border/40 bg-cui-light px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-cui-muted">
                    <Landmark className="h-3.5 w-3.5" />
                    Public Records
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void runEnrichment('fmcsa')}
                      disabled={enrichingSource !== null}
                      className="rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-text transition hover:bg-cui-light disabled:opacity-60"
                    >
                      {enrichingSource === 'fmcsa' ? 'Checking DOT…' : 'Pull DOT safety record'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void runEnrichment('osha')}
                      disabled={enrichingSource !== null}
                      className="rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-text transition hover:bg-cui-light disabled:opacity-60"
                    >
                      {enrichingSource === 'osha' ? 'Checking OSHA…' : 'Pull OSHA history'}
                    </button>
                  </div>
                </div>
                {enrichMessage ? <p className="px-3 py-2 text-xs text-cui-muted">{enrichMessage}</p> : null}
                {fmcsaCandidates && fmcsaCandidates.length > 0 ? (
                  <div className="divide-y divide-cui-light">
                    {fmcsaCandidates.map((candidate) => (
                      <div key={candidate.dot_number} className="flex items-center justify-between gap-3 px-3 py-2">
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-semibold text-cui-text">{candidate.legal_name}</p>
                          <p className="text-xs text-cui-muted">
                            DOT #{candidate.dot_number}
                            {candidate.city || candidate.state ? ` · ${[candidate.city, candidate.state].filter(Boolean).join(', ')}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void runEnrichment('fmcsa', candidate.dot_number)}
                          disabled={enrichingSource !== null}
                          className="shrink-0 rounded bg-cui-primary px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-cui-primary/90 disabled:opacity-60"
                        >
                          This one
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {!enrichMessage && !fmcsaCandidates ? (
                  <p className="px-3 py-2 text-xs text-cui-muted">
                    Pull free government data for this business: FMCSA carrier safety (fleet size, crashes, out-of-service rates) and OSHA
                    inspection history. Results are saved to the profile and used by Call Prep and drafting.
                  </p>
                ) : null}
              </div>

              {websitePayload ? <WebsiteSubmission payload={websitePayload} /> : null}

              {!structuredProfile && !websitePayload && payloadEntries.length > 0 ? (
                <div className="rounded border border-cui-border/60">
                  <div className="border-b border-cui-border/40 bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">Submitted Fields</div>
                  <table className="w-full text-left text-sm">
                    <tbody>
                      {payloadEntries.map(([key, value]) => (
                        <tr key={key} className="border-t border-cui-light first:border-t-0">
                          <td className="w-40 px-3 py-1.5 align-top font-semibold text-cui-muted">{humanizeKey(key)}</td>
                          <td className="break-all px-3 py-1.5">
                            {typeof value === 'string' && value.includes('\n') ? (
                              <AnswerLines text={value} />
                            ) : (
                              <span className="font-medium text-cui-text">{renderPayloadValue(value)}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {requestContext ? (
                <div className="rounded border border-cui-border/60">
                  <div className="border-b border-cui-border/40 bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted">Request Context</div>
                  <div className="space-y-1 p-3 text-sm">
                    <p><span className="font-semibold text-cui-muted">Referrer:</span> {renderPayloadValue(requestContext.referer)}</p>
                    <p className="break-all"><span className="font-semibold text-cui-muted">User Agent:</span> {renderPayloadValue(requestContext.user_agent)}</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'conversation' ? (
            <div className="space-y-3">
              {isLoadingConversation ? <p className="text-sm text-cui-muted">Loading conversation…</p> : null}
              {!isLoadingConversation && conversation.length === 0 ? (
                <p className="rounded border border-dashed border-cui-border/80 p-4 text-center text-sm text-cui-muted">
                  No messages yet. Send the first one below — it will be logged on this lead’s client record.
                </p>
              ) : null}
              {conversation.map((item) => {
                const outbound = (item.direction ?? 'outbound') === 'outbound';
                return (
                  <div key={item.id} className={`max-w-[85%] rounded border p-2.5 text-sm ${outbound ? 'ml-auto border-cui-primary/30 bg-cui-primary/5' : 'border-cui-border/60 bg-cui-light/60'}`}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-cui-muted">
                      <span className="font-bold uppercase">{item.channel ?? 'email'} · {outbound ? 'Sent' : 'Received'}</span>
                      <span>{prettyDateTime(item.sent_at)}</span>
                    </div>
                    {item.subject ? <p className="font-semibold text-cui-text">{item.subject}</p> : null}
                    <p className="whitespace-pre-wrap text-cui-text">{item.body || '--'}</p>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div hidden={tab !== 'assets'}>
            <RecordAssetsPanel target={{ type: 'lead', id: lead.id }} composeToken={assetComposeToken} refreshToken={recordRefreshToken} onChanged={onChanged} />
          </div>
          <div hidden={tab !== 'tasks' && tab !== 'notes'}>
            <RecordWorkPanel target={{ type: 'lead', id: lead.id }} name={lead.full_name} section={tab === 'notes' ? 'notes' : 'tasks'}
              compose={compose} refreshToken={recordRefreshToken} onChanged={onChanged} onTaskCount={setOpenTaskCount} />
          </div>
        </div>

        {/* Composer pinned to bottom on Conversation tab */}
        {tab === 'conversation' ? (
          <div className="shrink-0 border-t border-cui-border/60 p-3">
            <div className="mb-2 flex items-center gap-2">
              <select
                value={channel}
                onChange={(event) => setChannel(event.target.value as 'email' | 'sms')}
                className="rounded border border-cui-border px-2 py-1.5 text-sm"
              >
                <option value="email">Email</option>
                <option value="sms">SMS (log only)</option>
              </select>
              {channel === 'email' ? (
                <input
                  type="text"
                  value={subjectDraft}
                  onChange={(event) => setSubjectDraft(event.target.value)}
                  placeholder="Subject"
                  className="min-w-0 flex-1 rounded border border-cui-border px-2 py-1.5 text-sm"
                />
              ) : null}
            </div>
            {citedSignals.length > 0 ? (
              <p className="mb-2 rounded border border-cui-primary/30 bg-cui-primary/5 px-2.5 py-1.5 text-[11px] text-cui-muted">
                <span className="font-semibold text-cui-primary">Draft grounded on:</span> {citedSignals.join(' · ')}
              </p>
            ) : null}
            <div className="flex items-end gap-2">
              <textarea
                value={bodyDraft}
                onChange={(event) => setBodyDraft(event.target.value)}
                placeholder={
                  channel === 'email'
                    ? `Email ${lead.email ?? '(no email on file)'} — or type an instruction and use Draft`
                    : 'Log an SMS exchange…'
                }
                className="min-h-16 flex-1 rounded border border-cui-border px-3 py-2 text-sm"
              />
              <div className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => void draftWithAi()}
                  disabled={isDrafting}
                  title="Draft a personalized email from this lead's profile data"
                  className="flex items-center gap-1.5 rounded border border-cui-primary/40 bg-cui-primary/10 px-3 py-2 text-sm font-semibold text-cui-primary hover:bg-cui-primary/20 disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {isDrafting ? 'Drafting…' : 'Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => void sendMessage()}
                  disabled={isSending || bodyDraft.trim().length === 0 || (channel === 'email' && !lead.email)}
                  className="flex items-center gap-1.5 rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-60"
                >
                  <Send className="h-3.5 w-3.5" />
                  {isSending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
