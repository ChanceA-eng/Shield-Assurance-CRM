"use client";

import Link from 'next/link';
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
  claimsStatus: Array<{ status: string; value: number; color: string }>;
  leadPipeline: Array<{ stage: string; value: number; color: string }>;
  drilldowns: {
    policies: Array<{ id: string; insured_name?: string; carrier?: string; premium?: number; effective_date?: string; renewal_date?: string; status?: string }>;
    claims: Array<{ id: string; type?: string; status?: string; date_of_loss?: string; policies?: { insured_name?: string; carrier?: string } | null }>;
    endorsements: Array<{ id: string; type?: string; status?: string; effective_date?: string; policies?: { insured_name?: string; carrier?: string } | null }>;
    leads: Array<{ id: string; full_name?: string; status?: string; line_of_business?: string; source?: string }>;
  };
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

function formatDate(value?: string): string {
  if (!value) return '--';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString();
}

export default function ReportSlugPage(): JSX.Element {
  const params = useParams<{ reportSlug: ReportSlug }>();
  const slug = params.reportSlug;
  const [range, setRange] = useState<ReportsRange>('ytd');
  const [data, setData] = useState<ReportsPayload | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchReport = async (): Promise<void> => {
    setLoading(true);
    const res = await fetch(`/api/reports?range=${range}&carrier=all`, { cache: 'no-store' });
    const payload = (await res.json()) as ReportsPayload;
    setData(payload);
    setLoading(false);
  };

  useEffect(() => {
    void fetchReport();
  }, [range]);

  const title = titles[slug];

  const content = useMemo(() => {
    if (!data) return null;

    switch (slug) {
      case 'production':
        return data.drilldowns.policies.slice(0, 12).map((policy) => (
          <tr key={policy.id} className="border-t border-[#edf2f8]">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{policy.insured_name ?? '--'}</td>
            <td className="px-3 py-2">{policy.carrier ?? '--'}</td>
            <td className="px-3 py-2">{formatCurrency(policy.premium ?? 0)}</td>
            <td className="px-3 py-2">{formatDate(policy.effective_date)}</td>
            <td className="px-3 py-2">{policy.status ?? '--'}</td>
          </tr>
        ));
      case 'renewals':
        return data.drilldowns.policies
          .filter((policy) => !!policy.renewal_date)
          .slice(0, 12)
          .map((policy) => (
            <tr key={policy.id} className="border-t border-[#edf2f8]">
              <td className="px-3 py-2 font-semibold text-[#16324d]">{policy.insured_name ?? '--'}</td>
              <td className="px-3 py-2">{policy.carrier ?? '--'}</td>
              <td className="px-3 py-2">{formatDate(policy.renewal_date)}</td>
              <td className="px-3 py-2">{formatCurrency(policy.premium ?? 0)}</td>
              <td className="px-3 py-2">{policy.status ?? '--'}</td>
            </tr>
          ));
      case 'claims':
        return data.drilldowns.claims.slice(0, 12).map((claim) => (
          <tr key={claim.id} className="border-t border-[#edf2f8]">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{claim.policies?.insured_name ?? '--'}</td>
            <td className="px-3 py-2">{claim.policies?.carrier ?? '--'}</td>
            <td className="px-3 py-2">{claim.type ?? '--'}</td>
            <td className="px-3 py-2">{claim.status ?? '--'}</td>
            <td className="px-3 py-2">{claim.date_of_loss ?? '--'}</td>
          </tr>
        ));
      case 'endorsements':
        return data.drilldowns.endorsements.slice(0, 12).map((endorsement) => (
          <tr key={endorsement.id} className="border-t border-[#edf2f8]">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{endorsement.policies?.insured_name ?? '--'}</td>
            <td className="px-3 py-2">{endorsement.policies?.carrier ?? '--'}</td>
            <td className="px-3 py-2">{endorsement.type ?? '--'}</td>
            <td className="px-3 py-2">{endorsement.status ?? '--'}</td>
            <td className="px-3 py-2">{formatDate(endorsement.effective_date)}</td>
          </tr>
        ));
      case 'leads':
        return data.drilldowns.leads.slice(0, 12).map((lead) => (
          <tr key={lead.id} className="border-t border-[#edf2f8]">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{lead.full_name ?? '--'}</td>
            <td className="px-3 py-2">{lead.status ?? '--'}</td>
            <td className="px-3 py-2">{lead.line_of_business ?? '--'}</td>
            <td className="px-3 py-2">{lead.source ?? '--'}</td>
          </tr>
        ));
      case 'carriers':
        return data.carrierMix.slice(0, 12).map((carrier) => (
          <tr key={carrier.carrier} className="border-t border-[#edf2f8]">
            <td className="px-3 py-2 font-semibold text-[#16324d]">{carrier.carrier}</td>
            <td className="px-3 py-2">{carrier.count}</td>
            <td className="px-3 py-2">{formatCurrency(carrier.premium)}</td>
          </tr>
        ));
      default:
        return null;
    }
  }, [data, slug]);

  return (
    <SectionLayout title={title}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#d6deea] bg-gradient-to-r from-[#f5f9ff] via-white to-[#f3f7ff] p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#54739e]">Detailed Analytics</p>
          <h2 className="mt-1 text-xl font-semibold text-[#10273f]">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <select className="rounded-full border border-[#d6deea] bg-white px-3 py-2 text-xs font-semibold text-[#184168]" value={range} onChange={(e) => setRange(e.target.value as ReportsRange)}>
            <option value="mtd">MTD</option>
            <option value="ytd">YTD</option>
            <option value="qtd">QTD</option>
            <option value="12m">Last 12 Months</option>
          </select>
          <Link href="/reports" className="rounded-full bg-[#0f63b4] px-4 py-2 text-xs font-semibold text-white shadow hover:bg-[#0b4f92]">
            Back to Reports
          </Link>
        </div>
      </div>

      {loading ? <div className="text-sm text-[#60748a]">Loading report...</div> : null}
      {!loading && data ? (
        <div className="space-y-4">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">MTD Premium</p>
              <p className="mt-1 text-2xl font-bold text-[#10273f]">{formatCurrency(data.metrics.mtd_written_premium)}</p>
            </div>
            <div className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">YTD Premium</p>
              <p className="mt-1 text-2xl font-bold text-[#10273f]">{formatCurrency(data.metrics.ytd_written_premium)}</p>
            </div>
            <div className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">Open Claims</p>
              <p className="mt-1 text-2xl font-bold text-[#10273f]">{data.metrics.open_claims}</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[#0f2943]">{title}</h3>
              {slug === 'carriers' ? (
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

            <div className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <h3 className="mb-3 text-sm font-semibold text-[#0f2943]">Drilldown Table</h3>
              <div className="overflow-hidden rounded-xl border border-[#edf2f8]">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#f7f9fc] text-[#60748a]">
                    <tr>
                      {slug === 'production' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Premium</th><th className="px-3 py-2">Effective</th><th className="px-3 py-2">Status</th></>}
                      {slug === 'renewals' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Renewal</th><th className="px-3 py-2">Premium</th><th className="px-3 py-2">Status</th></>}
                      {slug === 'claims' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Loss Date</th></>}
                      {slug === 'endorsements' && <><th className="px-3 py-2">Insured</th><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Effective</th></>}
                      {slug === 'leads' && <><th className="px-3 py-2">Name</th><th className="px-3 py-2">Stage</th><th className="px-3 py-2">LOB</th><th className="px-3 py-2">Source</th></>}
                      {slug === 'carriers' && <><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Policies</th><th className="px-3 py-2">Premium</th></>}
                    </tr>
                  </thead>
                  <tbody>{content}</tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </SectionLayout>
  );
}
