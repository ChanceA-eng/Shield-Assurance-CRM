"use client";

import Link from 'next/link';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import SectionLayout from '../../components/crm/SectionLayout';

type ReportsRange = 'mtd' | 'ytd' | 'qtd' | '12m';
type ReportSlug = 'production' | 'renewals' | 'claims' | 'endorsements' | 'leads' | 'carriers';

interface ReportCard {
  id: ReportSlug;
  title: string;
  href: `/reports/${ReportSlug}`;
  summary: string;
  accent: string;
}

interface ReportsPayload {
  filters: {
    range: ReportsRange;
    carrier: string;
    start: string;
    end: string;
  };
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
  claimsStatus: Array<{ status: string; value: number; color: string }>;
  leadPipeline: Array<{ stage: string; value: number; color: string }>;
  reportCards: ReportCard[];
  drilldowns: {
    policies: Array<{ id: string; insured_name?: string; carrier?: string; premium?: number; effective_date?: string; renewal_date?: string; status?: string }>;
    claims: Array<{ id: string; type?: string; status?: string; date_of_loss?: string; policies?: { insured_name?: string; carrier?: string } | null }>;
    endorsements: Array<{ id: string; type?: string; status?: string; effective_date?: string; policies?: { insured_name?: string; carrier?: string } | null }>;
    leads: Array<{ id: string; full_name?: string; status?: string; line_of_business?: string; source?: string }>;
  };
}

const reportCards: ReportCard[] = [
  { id: 'production', title: 'Production Report', href: '/reports/production', summary: 'Written premium and production by period.', accent: 'sky' },
  { id: 'renewals', title: 'Renewals Report', href: '/reports/renewals', summary: 'Policies coming due by window and carrier.', accent: 'amber' },
  { id: 'claims', title: 'Claims Report', href: '/reports/claims', summary: 'Open claims by status and recent activity.', accent: 'rose' },
  { id: 'endorsements', title: 'Endorsements Report', href: '/reports/endorsements', summary: 'Open service changes and completion rate.', accent: 'violet' },
  { id: 'leads', title: 'Leads Pipeline Report', href: '/reports/leads', summary: 'Lead velocity by stage and source.', accent: 'emerald' },
  { id: 'carriers', title: 'Carrier Mix Report', href: '/reports/carriers', summary: 'Distribution of premium and count by carrier.', accent: 'indigo' },
];

function metricTone(index: number): string {
  const tones = [
    'from-sky-500/20 to-cyan-500/5 ring-sky-200',
    'from-emerald-500/20 to-green-500/5 ring-emerald-200',
    'from-indigo-500/20 to-violet-500/5 ring-indigo-200',
    'from-rose-500/20 to-red-500/5 ring-rose-200',
    'from-violet-500/20 to-fuchsia-500/5 ring-violet-200',
  ];
  return tones[index % tones.length];
}

function formatCurrency(value: number): string {
  return `$${value.toLocaleString()}`;
}

function formatDate(value?: string): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export default function ReportsPage(): JSX.Element {
  const [range, setRange] = useState<ReportsRange>('mtd');
  const [carrier, setCarrier] = useState('all');
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ range, carrier });
    const res = await fetch(`/api/reports?${params.toString()}`, { cache: 'no-store' });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ message: 'Failed to load reports.' }))) as { message?: string };
      setError(body.message ?? 'Failed to load reports.');
      setLoading(false);
      return;
    }

    const payload = (await res.json()) as ReportsPayload;
    setData(payload);
    setLoading(false);
  };

  useEffect(() => {
    void fetchReports();
  }, [range, carrier]);

  const carriers = useMemo(() => Array.from(new Set((data?.carrierMix ?? []).map((item) => item.carrier))).filter(Boolean), [data]);

  return (
    <SectionLayout title="Reports">
      <div className="mb-4 rounded-2xl border border-[#d6deea] bg-gradient-to-r from-[#f5f9ff] via-white to-[#f3f7ff] p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#54739e]">Analytics Engine</p>
            <h2 className="mt-1 text-xl font-semibold text-[#10273f]">Reports Dashboard</h2>
            <p className="mt-1 text-sm text-[#5f738c]">Decision-ready analytics pulled directly from Supabase.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <select className="rounded-full border border-[#d6deea] bg-white px-3 py-2 text-xs font-semibold text-[#184168]" value={range} onChange={(e) => setRange(e.target.value as ReportsRange)}>
              <option value="mtd">MTD</option>
              <option value="ytd">YTD</option>
              <option value="qtd">QTD</option>
              <option value="12m">Last 12 Months</option>
            </select>

            <select className="rounded-full border border-[#d6deea] bg-white px-3 py-2 text-xs font-semibold text-[#184168]" value={carrier} onChange={(e) => setCarrier(e.target.value)}>
              <option value="all">All Carriers</option>
              {carriers.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>

            <button type="button" onClick={() => void fetchReports()} className="rounded-full bg-[#0f63b4] px-4 py-2 text-xs font-semibold text-white shadow transition hover:-translate-y-0.5 hover:bg-[#0b4f92]">
              Refresh
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#60748a]">Loading reports...</div> : null}

      {!loading && data ? (
        <div className="space-y-5">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {[
              { label: 'MTD Premium', value: formatCurrency(data.metrics.mtd_written_premium), helper: `${range.toUpperCase()} production`, href: '/reports/production' as const },
              { label: 'Active Clients', value: data.metrics.active_clients.toLocaleString(), helper: 'Live client count', href: '/reports/leads' as const },
              { label: 'Active Policies', value: data.metrics.active_policies.toLocaleString(), helper: 'Policies in force', href: '/reports/production' as const },
              { label: 'Open Claims', value: data.metrics.open_claims.toLocaleString(), helper: 'Claims needing attention', href: '/reports/claims' as const },
              { label: 'Open Endorsements', value: data.metrics.open_endorsements.toLocaleString(), helper: 'Service changes pending', href: '/reports/endorsements' as const },
            ].map((metric, index) => (
              <Link key={metric.label} href={metric.href} className={`group relative overflow-hidden rounded-2xl border bg-white p-4 shadow-sm ring-1 transition hover:-translate-y-0.5 hover:shadow-lg ${metricTone(index)}`}>
                <div className="relative">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">{metric.label}</p>
                  <p className="mt-2 text-2xl font-bold text-[#10273f]">{metric.value}</p>
                  <p className="mt-1 text-[11px] font-semibold text-[#587189]">{metric.helper}</p>
                </div>
              </Link>
            ))}
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm xl:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#0f2943]">Premium Trend</h3>
                <Link href="/reports/production" className="text-xs font-semibold text-[#0f62af] hover:underline">
                  Open report
                </Link>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.premiumTrend}>
                    <XAxis dataKey="month" stroke="#64748b" tickLine={false} axisLine={false} />
                    <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Line type="monotone" dataKey="premium" stroke="#0ea5e9" strokeWidth={3} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#0f2943]">Carrier Mix</h3>
                <Link href="/reports/carriers" className="text-xs font-semibold text-[#0f62af] hover:underline">
                  Open report
                </Link>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.carrierMix}>
                    <XAxis dataKey="carrier" stroke="#64748b" tickLine={false} axisLine={false} interval={0} angle={-10} height={60} />
                    <YAxis stroke="#64748b" tickLine={false} axisLine={false} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Bar dataKey="premium" fill="#6366f1" radius={[8, 8, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#0f2943]">Claims Status</h3>
                <Link href="/reports/claims" className="text-xs font-semibold text-[#0f62af] hover:underline">
                  Open report
                </Link>
              </div>
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
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#0f2943]">Lead Pipeline</h3>
                <Link href="/reports/leads" className="text-xs font-semibold text-[#0f62af] hover:underline">
                  Open report
                </Link>
              </div>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <FunnelChart>
                    <Funnel dataKey="value" data={data.leadPipeline} isAnimationActive>
                      <LabelList dataKey="stage" position="right" fill="#10273f" />
                    </Funnel>
                    <Tooltip />
                  </FunnelChart>
                </ResponsiveContainer>
              </div>
            </article>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0f2943]">Production Drilldown</h3>
              <div className="mt-3 space-y-2 text-sm">
                {data.drilldowns.policies.slice(0, 5).map((policy) => (
                  <div key={policy.id} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2">
                    <p className="font-semibold text-[#14324f]">{policy.insured_name ?? 'Unnamed policy'}</p>
                    <p className="text-xs text-[#667b90]">
                      {policy.carrier ?? '--'} · {formatCurrency(policy.premium ?? 0)} · {formatDate(policy.effective_date)}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0f2943]">Claims Drilldown</h3>
              <div className="mt-3 space-y-2 text-sm">
                {data.drilldowns.claims.slice(0, 5).map((claim) => (
                  <div key={claim.id} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2">
                    <p className="font-semibold text-[#14324f]">{claim.policies?.insured_name ?? 'Unknown insured'}</p>
                    <p className="text-xs text-[#667b90]">
                      {claim.policies?.carrier ?? '--'} · {claim.type ?? 'Claim'} · {claim.status ?? 'open'}
                    </p>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-[#0f2943]">Report Cards</h3>
              <div className="mt-3 space-y-2">
                {reportCards.map((card) => (
                  <Link key={card.id} href={card.href} className="block rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2 hover:bg-[#f1f7ff]">
                    <p className="font-semibold text-[#14324f]">{card.title}</p>
                    <p className="text-xs text-[#667b90]">{card.summary}</p>
                  </Link>
                ))}
              </div>
            </article>
          </section>
        </div>
      ) : null}
    </SectionLayout>
  );
}