"use client";

import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import SectionLayout from '../../../components/crm/SectionLayout';

type ReportSlug = 'production' | 'renewals' | 'claims' | 'endorsements' | 'leads' | 'carriers';
type ReportsRange = 'mtd' | 'ytd' | 'qtd' | '12m';

interface ReportsPayload {
  metrics: {
    mtd_written_premium: number;
    ytd_written_premium: number;
    active_clients: number;
    active_policies: number;
    open_claims: number;
    open_endorsements: number;
  };
  premiumTrend: Array<{ month: string; premium: number }>;
  carrierMix: Array<{ carrier: string; count: number; premium: number }>;
  carrierOptions: string[];
  claimsStatus: Array<{ status: string; value: number; color: string }>;
  leadPipeline: Array<{ stage: string; value: number; color: string }>;
  drilldowns: {
    policies: Array<{ id: string; insured_name?: string; carrier?: string; premium?: number; effective_date?: string; renewal_date?: string; status?: string }>;
    claims: Array<{ id: string; type?: string; status?: string; date_of_loss?: string; policies?: { insured_name?: string; carrier?: string } | null }>;
    endorsements: Array<{ id: string; type?: string; status?: string; effective_date?: string; policies?: { insured_name?: string; carrier?: string } | null }>;
    leads: Array<{ id: string; full_name?: string; status?: string; line_of_business?: string; source?: string }>;
  };
}

interface ReportDetailRow {
  id: string;
  account_id: string | null;
  insured_name: string | null;
  carrier: string | null;
  premium: number | null;
  effective_date: string | null;
  renewal_date: string | null;
  status: string | null;
  type: string | null;
  date_of_loss: string | null;
  full_name: string | null;
  line_of_business: string | null;
  source: string | null;
  count: number | null;
}

interface ReportDetailPayload {
  rows: ReportDetailRow[];
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  filters: { start: string; end: string; renewalStart?: string; renewalEnd?: string };
}

const titles: Record<ReportSlug, string> = {
  production: 'Production Report',
  renewals: 'Renewals Report',
  claims: 'Claims Report',
  endorsements: 'Endorsements Report',
  leads: 'Leads Pipeline Report',
  carriers: 'Carrier Mix Report',
};

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

function recordHref(slug: ReportSlug, row: ReportDetailRow): string | null {
  if (!row.account_id) return null;
  if (slug === 'leads') return `/clients/workspace?lead=${encodeURIComponent(row.id)}`;
  const type = slug === 'claims' ? 'claim' : slug === 'endorsements' ? 'endorsement' : 'policy';
  return `/clients/${encodeURIComponent(row.account_id)}?${new URLSearchParams({ context_type: type, context_id: row.id })}`;
}

function linkedRecordName(slug: ReportSlug, row: ReportDetailRow, label: string | null): React.ReactNode {
  const href = recordHref(slug, row);
  return href ? <Link className="underline" href={href as Route}>{label ?? '--'}</Link> : label ?? '--';
}

export default function ReportSlugPage(): JSX.Element {
  const params = useParams<{ reportSlug: ReportSlug }>();
  const slug = params.reportSlug;
  const [range, setRange] = useState<ReportsRange>('ytd');
  const [carrier, setCarrier] = useState('all');
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [detail, setDetail] = useState<ReportDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(true);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      const selectedCarrier = slug === 'leads' ? 'all' : carrier;
      try {
        const query = new URLSearchParams({ range, carrier: selectedCarrier });
        const response = await fetch(`/api/reports?${query}`, { cache: 'no-store' });
        const payload = (await response.json()) as ReportsPayload & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? 'Report could not be loaded. Refresh and retry.');
        if (active) setData(payload);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Report could not be loaded. Refresh and retry.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [range, carrier, slug]);

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      setDetailLoading(true);
      setDetailError(null);
      try {
        const query = new URLSearchParams({
          range,
          carrier: slug === 'leads' ? 'all' : carrier,
          page: String(page),
        });
        const response = await fetch(`/api/reports/${slug}?${query}`, { cache: 'no-store' });
        const payload = (await response.json()) as ReportDetailPayload & { message?: string };
        if (!response.ok) throw new Error(payload.message ?? 'Report details could not be loaded. Refresh and retry.');
        if (active) setDetail(payload);
      } catch (loadError) {
        if (active) setDetailError(loadError instanceof Error ? loadError.message : 'Report details could not be loaded. Refresh and retry.');
      } finally {
        if (active) setDetailLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [range, carrier, page, slug]);

  const title = titles[slug];

  const content = useMemo(() => {
    if (!detail) return null;

    switch (slug) {
      case 'production':
        return detail.rows.map((policy) => (
          <tr key={policy.id} className="border-t border-cui-light">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{linkedRecordName(slug, policy, policy.insured_name)}</td>
            <td className="px-3 py-2">{policy.carrier ?? '--'}</td>
            <td className="px-3 py-2">{formatCurrency(policy.premium ?? 0)}</td>
            <td className="px-3 py-2">{formatDate(policy.effective_date)}</td>
            <td className="px-3 py-2">{policy.status ?? '--'}</td>
          </tr>
        ));
      case 'renewals':
        return detail.rows.map((policy) => (
            <tr key={policy.id} className="border-t border-cui-light">
              <td className="px-3 py-2 font-semibold text-[#16324d]">{linkedRecordName(slug, policy, policy.insured_name)}</td>
              <td className="px-3 py-2">{policy.carrier ?? '--'}</td>
              <td className="px-3 py-2">{formatDate(policy.renewal_date)}</td>
              <td className="px-3 py-2">{formatCurrency(policy.premium ?? 0)}</td>
              <td className="px-3 py-2">{policy.status ?? '--'}</td>
            </tr>
        ));
      case 'claims':
        return detail.rows.map((claim) => (
          <tr key={claim.id} className="border-t border-cui-light">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{linkedRecordName(slug, claim, claim.insured_name)}</td>
            <td className="px-3 py-2">{claim.carrier ?? '--'}</td>
            <td className="px-3 py-2">{claim.type ?? '--'}</td>
            <td className="px-3 py-2">{claim.status ?? '--'}</td>
            <td className="px-3 py-2">{formatDate(claim.date_of_loss ?? undefined)}</td>
          </tr>
        ));
      case 'endorsements':
        return detail.rows.map((endorsement) => (
          <tr key={endorsement.id} className="border-t border-cui-light">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{linkedRecordName(slug, endorsement, endorsement.insured_name)}</td>
            <td className="px-3 py-2">{endorsement.carrier ?? '--'}</td>
            <td className="px-3 py-2">{endorsement.type ?? '--'}</td>
            <td className="px-3 py-2">{endorsement.status ?? '--'}</td>
            <td className="px-3 py-2">{formatDate(endorsement.effective_date)}</td>
          </tr>
        ));
      case 'leads':
        return detail.rows.map((lead) => (
          <tr key={lead.id} className="border-t border-cui-light">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{linkedRecordName(slug, lead, lead.full_name)}</td>
            <td className="px-3 py-2">{lead.status ?? '--'}</td>
            <td className="px-3 py-2">{lead.line_of_business ?? '--'}</td>
            <td className="px-3 py-2">{lead.source ?? '--'}</td>
          </tr>
        ));
      case 'carriers':
        return detail.rows.map((row) => (
          <tr key={row.id} className="border-t border-cui-light">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{row.carrier ?? '--'}</td>
            <td className="px-3 py-2">{row.count ?? 0}</td>
            <td className="px-3 py-2">{formatCurrency(row.premium ?? 0)}</td>
          </tr>
        ));
      default:
        return null;
    }
  }, [detail, slug]);

  return (
    <SectionLayout title={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d8dde2] bg-gradient-to-r from-[#f5f9ff] via-white to-[#f3f7ff] p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#54739e]">Detailed Analytics</p>
          <h2 className="mt-1 text-xl font-semibold text-cui-text">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {slug !== 'renewals' ? (
            <select aria-label="Reporting period" className="rounded-full border border-[#d8dde2] bg-white px-3 py-2 text-xs font-semibold text-[#184168]" value={range} onChange={(event) => { setRange(event.target.value as ReportsRange); setPage(1); }}>
              <option value="mtd">MTD</option>
              <option value="ytd">YTD</option>
              <option value="qtd">QTD</option>
              <option value="12m">Last 12 Months</option>
            </select>
          ) : null}
          {slug !== 'leads' ? (
            <select aria-label="Carrier filter" className="rounded-full border border-[#d8dde2] bg-white px-3 py-2 text-xs font-semibold text-[#184168]" value={carrier} onChange={(event) => { setCarrier(event.target.value); setPage(1); }}>
              <option value="all">All Carriers</option>
              {data?.carrierOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : null}
          <a
            href={`/api/reports/${slug}?${new URLSearchParams({ range, carrier: slug === 'leads' ? 'all' : carrier, format: 'csv' })}`}
            className="rounded-full border border-[#b8c5d1] bg-white px-4 py-2 text-xs font-semibold text-[#184168] hover:bg-[#f5f9ff]"
          >
            Export full CSV
          </a>
          <Link href="/reports" className="rounded-full bg-[#0f63b4] px-4 py-2 text-xs font-semibold text-white shadow hover:bg-[#0b4f92]">
            Back to Reports
          </Link>
        </div>
      </div>

      {loading ? <div className="text-sm text-cui-muted">Loading report...</div> : null}
      {error ? <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {slug === 'renewals' && detail ? <p className="mb-3 text-xs text-cui-muted">Upcoming renewals from {formatDate(detail.filters.renewalStart)} through {formatDate(detail.filters.renewalEnd)}.</p> : null}
      {!loading && data ? (
        <div className="space-y-4">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-cui-light bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">MTD Premium</p>
              <p className="mt-1 text-2xl font-bold text-cui-text">{formatCurrency(data.metrics.mtd_written_premium)}</p>
            </div>
            <div className="rounded-2xl border border-cui-light bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">YTD Premium</p>
              <p className="mt-1 text-2xl font-bold text-cui-text">{formatCurrency(data.metrics.ytd_written_premium)}</p>
            </div>
            <div className="rounded-2xl border border-cui-light bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">Open Claims</p>
              <p className="mt-1 text-2xl font-bold text-cui-text">{data.metrics.open_claims}</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-cui-light bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-cui-text">{title}</h3>
              {slug === 'carriers' ? (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.carrierMix}>
                      <XAxis dataKey="carrier" stroke="#73818f" tickLine={false} axisLine={false} interval={0} angle={-10} height={60} />
                      <YAxis stroke="#73818f" tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                      <Bar dataKey="premium" fill="#6366f1" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={data.claimsStatus} dataKey="value" nameKey="status" innerRadius={62} outerRadius={94} paddingAngle={3}>
                        {data.claimsStatus.map((entry) => (
                          <Cell key={entry.status} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-cui-light bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-cui-text">Drilldown Table</h3>
              {detailError ? <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{detailError}</div> : null}
              {detailLoading ? <p className="mb-2 text-xs text-cui-muted">Loading matching records...</p> : null}
              <div className="overflow-x-auto rounded-xl border border-cui-light">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f9fc] text-cui-muted">
                    <tr>
                      {slug === 'production' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Premium</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Status</th></>}
                      {slug === 'renewals' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Renewal</th><th className="px-3 py-2">Premium</th><th className="px-3 py-2">Status</th></>}
                      {slug === 'claims' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Loss Date</th></>}
                      {slug === 'endorsements' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Effective</th></>}
                      {slug === 'leads' && <><th className="px-3 py-2">Name</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">LOB</th><th className="px-3 py-2">Source</th></>}
                      {slug === 'carriers' && <><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Policies</th><th className="px-3 py-2">Premium</th></>}
                    </tr>
                  </thead>
                  <tbody>{content ?? <tr><td className="px-3 py-6 text-center text-cui-muted" colSpan={5}>No matching records.</td></tr>}</tbody>
                </table>
              </div>
              {detail ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[#516680]">
                  <span>{detail.total.toLocaleString()} matching records · Page {detail.page} of {Math.max(detail.pageCount, 1)}</span>
                  <div className="flex gap-2">
                    <button type="button" disabled={detailLoading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded-lg border border-[#d8dde2] px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Previous</button>
                    <button type="button" disabled={detailLoading || page >= detail.pageCount} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-[#d8dde2] px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50">Next</button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </SectionLayout>
  );
}
