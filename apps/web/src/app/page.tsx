'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { CalendarClock, CircleDollarSign, ShieldAlert, Users } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import type { PremiumMonth } from '../lib/home-metrics';
import StatWidget from '../components/ui/StatWidget';
import SectionLayout from '../components/crm/SectionLayout';
import { workspaceFetch } from '../lib/workspace-fetch';
import type { HomeMetrics } from '../lib/home-metrics';
import { useDashboardCountUp } from '../lib/use-dashboard-count-up';
import type { TaskTimeliness } from '../lib/task-timeliness';

const PremiumChart = dynamic(() => import('../components/dashboard/PremiumChart'), {
  ssr: false,
  loading: () => <div className="h-52 animate-pulse rounded bg-cui-light" aria-label="Loading premium chart" />,
});
const TaskTimelinessChart = dynamic(() => import('../components/dashboard/TaskTimelinessChart'), {
  ssr: false, loading: () => <div className="h-52 animate-pulse rounded bg-cui-light" aria-label="Loading task chart" />,
});

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
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [renewalsLoading, setRenewalsLoading] = useState(true);
  const [metricsError, setMetricsError] = useState('');
  const [renewalsError, setRenewalsError] = useState('');
  const [taskMetrics, setTaskMetrics] = useState<TaskTimeliness | null>(null), [taskError, setTaskError] = useState('');
  const [taskRefresh, setTaskRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setTaskError('');
    void workspaceFetch<TaskTimeliness>('/api/metrics/tasks').then((result) => { if (active) setTaskMetrics(result); })
      .catch((failure: unknown) => { if (active) setTaskError(failure instanceof Error ? failure.message : 'Task metrics could not be loaded.'); });
    return () => { active = false; };
  }, [taskRefresh]);
  const premiumCount = useDashboardCountUp(metrics?.total_written_premium ?? null);
  const leadCount = useDashboardCountUp(metrics?.active_leads ?? null);
  const renewalCount = useDashboardCountUp(metrics?.renewals_30_days ?? null);
  const claimCount = useDashboardCountUp(metrics?.open_claims ?? null);
  useEffect(() => {
    let cancelled = false;
    void workspaceFetch<HomeMetrics>('/api/metrics/home').then((home) => {
      if (!cancelled) setMetrics(home);
    }).catch((failure: unknown) => {
      if (!cancelled) setMetricsError(failure instanceof Error ? failure.message : 'Dashboard metrics could not be loaded.');
    }).finally(() => {
      if (!cancelled) setMetricsLoading(false);
    });
    void workspaceFetch<{ items?: Renewal[] }>('/api/renewals?window=30').then((renewalRows) => {
      if (!cancelled) setRenewals(renewalRows.items ?? []);
    }).catch((failure: unknown) => {
      if (!cancelled) setRenewalsError(failure instanceof Error ? failure.message : 'Renewals could not be loaded.');
    }).finally(() => {
      if (!cancelled) setRenewalsLoading(false);
    });
    return () => { cancelled = true; };
  }, []);
  const series = metrics?.written_premium_series ?? [];
  const conversion = metrics ? Math.round(metrics.lead_conversion_rate * 100) : null;
  return <SectionLayout title="Dashboard"><div className="space-y-5">
    {metricsError ? <p role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">{metricsError}</p> : null}
    {renewalsError ? <p role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">{renewalsError}</p> : null}
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatWidget label="Total Written Premium" value={metricsLoading ? '...' : metrics ? currency(premiumCount) : '--'} color="primary" icon={CircleDollarSign} href="/policies" />
      <StatWidget label="Active Leads" value={metricsLoading ? '...' : metrics ? String(Math.floor(leadCount)) : '--'} color="info" icon={Users} href="/leads"
        footer={<p className="text-xs text-white/90">{conversion !== null ? `${conversion}% conversion` : 'Conversion unavailable'}</p>} />
      <StatWidget label="Renewals (30 Days)" value={metricsLoading ? '...' : metrics ? String(Math.floor(renewalCount)) : '--'} color="warning" icon={CalendarClock} href="/renewals" />
      <StatWidget label="Open Claims" value={metricsLoading ? '...' : metrics ? String(Math.floor(claimCount)) : '--'} color="danger" icon={ShieldAlert} href="/claims" />
    </div>
    <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-dashboard-charts>
    <Card>
      <CardHeader>Written Premium - Last 12 Months</CardHeader>
      <CardBody>
        {metricsLoading ? <p className="py-12 text-center text-sm text-cui-muted">Loading premium data...</p>
          : metricsError ? <p className="py-12 text-center text-sm text-cui-muted">Premium data unavailable.</p>
            : series.some((item: PremiumMonth) => item.premium > 0)
              ? <PremiumChart series={series} />
              : <p className="py-12 text-center text-sm text-cui-muted">No written premium recorded in this period.</p>}
      </CardBody>
    </Card>
    <Card>
      <CardHeader actions={<Link href="/tasks" className="text-xs font-semibold text-cui-primary hover:underline">View tasks</Link>}>Task timing</CardHeader>
      <CardBody>
        {taskError ? <p role="alert" className="py-12 text-center text-sm text-cui-danger">{taskError}{' '}
          <button type="button" className="underline" onClick={() => setTaskRefresh((value) => value + 1)}>Retry task chart</button></p>
          : !taskMetrics ? <p className="py-12 text-center text-sm text-cui-muted">Loading tasks...</p>
            : taskMetrics.on_time + taskMetrics.overdue + taskMetrics.open + taskMetrics.unclassified > 0 ? <TaskTimelinessChart metrics={taskMetrics} />
              : <p className="py-12 text-center text-sm text-cui-muted">{taskMetrics.unclassified ? 'Task completion timing is unavailable.' : 'No tasks yet.'}</p>}
      </CardBody>
    </Card>
    </div>
    <Card>
      <CardHeader actions={<Link href="/renewals" className="text-xs font-semibold text-cui-primary hover:underline">View renewals</Link>}>Upcoming Renewals (30 Days)</CardHeader>
      <CardBody className="p-0">
        {renewalsLoading ? <p className="p-6 text-center text-sm text-cui-muted">Loading renewals...</p>
          : renewals.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-cui-border bg-cui-light text-xs uppercase text-cui-muted">{['Insured', 'Carrier', 'Line of business', 'Renewal date', 'Premium'].map((label) => <th key={label} className="px-4 py-2 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-cui-border/50">{renewals.slice(0, 8).map((renewal) => <tr key={renewal.id} className="hover:bg-cui-light/60">
            <td className="px-4 py-3 font-medium text-cui-text">{renewal.insured_name}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.carrier}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.line_of_business}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.renewal_date ?? renewal.expiration_date ?? '--'}</td>
            <td className="px-4 py-3 font-medium text-cui-text">{currency(numeric(renewal.premium))}</td>
          </tr>)}</tbody>
        </table></div> : <p className="p-6 text-center text-sm text-cui-muted">{renewalsError ? 'Renewal data unavailable.' : 'No renewals due in the next 30 days.'}</p>}
      </CardBody>
    </Card>
  </div></SectionLayout>;
}
