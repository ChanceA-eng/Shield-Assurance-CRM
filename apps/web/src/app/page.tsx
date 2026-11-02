'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarClock, CircleDollarSign, ShieldAlert, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import StatWidget from '../components/ui/StatWidget';
import { workspaceFetch } from '../lib/workspace-fetch';
import type { HomeMetrics } from '../lib/home-metrics';
interface Renewal {
  id: string;
  insured_name: string;
  carrier: string;
  line_of_business: string;
  premium: number | string | null;
  renewal_date: string | null;
  expiration_date: string | null;
}
function numeric(value: number | string | null): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function currency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
export default function DashboardPage(): JSX.Element {
  const [metrics, setMetrics] = useState<HomeMetrics | null>(null);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      workspaceFetch<HomeMetrics>('/api/metrics/home'),
      workspaceFetch<{ items?: Renewal[] }>('/api/renewals?window=30'),
    ]).then(([home, renewalRows]) => {
      if (cancelled) return;
      setMetrics(home); setRenewals(renewalRows.items ?? []);
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Dashboard data could not be loaded.');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  const series = metrics?.written_premium_series ?? [];
  const conversion = metrics ? Math.round(metrics.lead_conversion_rate * 100) : null;
  return <div className="space-y-5 p-4 md:p-6">
    <div><h1 className="text-2xl font-bold text-cui-text">Dashboard</h1><p className="mt-1 text-sm text-cui-muted">Your agency at a glance.</p></div>
    {error ? <p role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">{error}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatWidget label="Total Written Premium" value={loading ? '...' : metrics ? currency(metrics.total_written_premium) : '--'} color="primary" icon={CircleDollarSign} href="/policies" />
      <StatWidget label="Active Leads" value={loading ? '...' : metrics ? String(metrics.active_leads) : '--'} color="info" icon={Users} href="/leads"
        footer={<p className="text-xs text-white/90">{conversion !== null ? `${conversion}% conversion` : 'Conversion unavailable'}</p>} />
      <StatWidget label="Renewals (30 Days)" value={loading ? '...' : metrics ? String(metrics.renewals_30_days) : '--'} color="warning" icon={CalendarClock} href="/renewals" />
      <StatWidget label="Open Claims" value={loading ? '...' : metrics ? String(metrics.open_claims) : '--'} color="danger" icon={ShieldAlert} href="/claims" />
    </div>
    <Card>
      <CardHeader>Written Premium - Last 12 Months</CardHeader>
      <CardBody>
        {series.some((item) => item.premium > 0) ? <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs><linearGradient id="premiumFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#20a8d8" stopOpacity={0.35} /><stop offset="100%" stopColor="#20a8d8" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e5e6" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#73818f' }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fontSize: 12, fill: '#73818f' }} tickLine={false} axisLine={false} tickFormatter={currency} width={64} />
              <Tooltip formatter={(value) => [currency(numeric(typeof value === 'number' || typeof value === 'string' ? value : null)), 'Premium']} />
              <Area type="monotone" dataKey="premium" stroke="#20a8d8" strokeWidth={2} fill="url(#premiumFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div> : <p className="py-12 text-center text-sm text-cui-muted">{loading ? 'Loading premium data...' : error ? 'Premium data unavailable.' : 'No written premium recorded in this period.'}</p>}
      </CardBody>
    </Card>
    <Card>
      <CardHeader actions={<Link href="/renewals" className="text-xs font-semibold text-cui-primary hover:underline">View renewals</Link>}>Upcoming Renewals (30 Days)</CardHeader>
      <CardBody className="p-0">
        {renewals.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-cui-border bg-cui-light text-xs uppercase text-cui-muted">{['Insured', 'Carrier', 'Line of business', 'Renewal date', 'Premium'].map((label) => <th key={label} className="px-4 py-2 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-cui-border/50">{renewals.slice(0, 8).map((renewal) => <tr key={renewal.id} className="hover:bg-cui-light/60">
            <td className="px-4 py-3 font-medium text-cui-text">{renewal.insured_name}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.carrier}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.line_of_business}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.renewal_date ?? renewal.expiration_date ?? '--'}</td>
            <td className="px-4 py-3 font-medium text-cui-text">{currency(numeric(renewal.premium))}</td>
          </tr>)}</tbody>
        </table></div> : <p className="p-6 text-center text-sm text-cui-muted">{loading ? 'Loading renewals...' : error ? 'Renewal data unavailable.' : 'No renewals due in the next 30 days.'}</p>}
      </CardBody>
    </Card>
  </div>;
}
