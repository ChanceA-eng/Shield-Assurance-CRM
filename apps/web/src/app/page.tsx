'use client';

import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { CalendarClock, CircleDollarSign, ShieldAlert, Users } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import StatWidget from '../components/ui/StatWidget';
import SectionLayout from '../components/crm/SectionLayout';
import { workspaceFetch } from '../lib/workspace-fetch';
import type { DashboardData, DashboardRenewal } from '../lib/home-metrics';
import { useDashboardCountUp } from '../lib/use-dashboard-count-up';
import type { TaskTimeliness } from '../lib/task-timeliness';

const PremiumChart = dynamic(() => import('../components/dashboard/PremiumChart'), {
  ssr: false,
  loading: () => <div className="h-52 animate-pulse rounded bg-cui-light" aria-label="Loading premium chart" />,
});
const TaskTimelinessChart = dynamic(() => import('../components/dashboard/TaskTimelinessChart'), {
  ssr: false, loading: () => <div className="h-52 animate-pulse rounded bg-cui-light" aria-label="Loading task chart" />,
});

function currency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

export default function DashboardPage(): JSX.Element {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [tasks, setTasks] = useState<TaskTimeliness | null>(null);
  const [taskError, setTaskError] = useState('');
  const [taskLoading, setTaskLoading] = useState(true);
  const [taskRevision, setTaskRevision] = useState(0);
  const [renewals, setRenewals] = useState<DashboardRenewal[] | null>(null);
  const [renewalsError, setRenewalsError] = useState('');
  const [renewalsLoading, setRenewalsLoading] = useState(true);
  const [renewalsRevision, setRenewalsRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void workspaceFetch<DashboardData>('/api/dashboard').then((result) => {
      if (active) setData(result);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Dashboard data could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [revision]);
  useEffect(() => {
    let active = true;
    setTaskError(''); setTaskLoading(true);
    void workspaceFetch<{ tasks: TaskTimeliness | null }>('/api/dashboard?section=tasks').then((result) => {
      if (active) setTasks(result.tasks);
    }).catch((failure: unknown) => {
      if (active) setTaskError(failure instanceof Error ? failure.message : 'Task metrics could not be loaded.');
    }).finally(() => { if (active) setTaskLoading(false); });
    return () => { active = false; };
  }, [taskRevision]);
  useEffect(() => {
    let active = true;
    setRenewalsLoading(true); setRenewalsError('');
    void workspaceFetch<{ renewals: DashboardRenewal[] | null }>('/api/dashboard?section=renewals').then((result) => {
      if (active) setRenewals(result.renewals);
    }).catch((failure: unknown) => {
      if (active) setRenewalsError(failure instanceof Error ? failure.message : 'Renewals could not be loaded.');
    }).finally(() => { if (active) setRenewalsLoading(false); });
    return () => { active = false; };
  }, [renewalsRevision]);
  const premiumCount = useDashboardCountUp(data?.policies?.total_written_premium ?? null);
  const leadCount = useDashboardCountUp(data?.leads?.active ?? null);
  const renewalCount = useDashboardCountUp(data?.policies?.renewals_30_days ?? null);
  const claimCount = useDashboardCountUp(data?.policies?.open_claims ?? null);
  const policies = data?.policies;
  const leads = data?.leads;
  return <SectionLayout title="Dashboard"><div className="space-y-5">
    {error && <p role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">
      {error} <button type="button" className="underline" onClick={() => setRevision((value) => value + 1)}>Retry</button>
    </p>}
    {renewalsError && <p role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">
      {renewalsError} <button type="button" className="underline" onClick={() => setRenewalsRevision((value) => value + 1)}>Retry renewals</button>
    </p>}
    {loading && !data && <p className="text-sm text-cui-muted">Loading dashboard...</p>}
    {data && !policies && !leads && !tasks && !taskLoading && !taskError && <Card><CardBody><p className="text-sm text-cui-muted">No dashboard data is available for your current access.</p></CardBody></Card>}
    {(policies || leads) && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {policies && <StatWidget label={policies.scope === 'assigned' ? 'Assigned Written Premium' : 'Total Written Premium'} value={currency(premiumCount)} color="primary" icon={CircleDollarSign} href="/policies" />}
      {leads && <StatWidget label={leads.scope === 'assigned' ? 'Assigned Active Leads' : 'Active Leads'} value={String(Math.floor(leadCount))}
        color="info" icon={Users} href="/leads" footer={<p className="text-xs text-white/90">{Math.round(leads.conversion * 100)}% conversion</p>} />}
      {policies && <StatWidget label={policies.scope === 'assigned' ? 'Assigned Renewals (30 Days)' : 'Renewals (30 Days)'} value={String(Math.floor(renewalCount))} color="warning" icon={CalendarClock} href="/renewals" />}
      {policies && <StatWidget label={policies.scope === 'assigned' ? 'Assigned Open Claims' : 'Open Claims'} value={String(Math.floor(claimCount))} color="danger" icon={ShieldAlert} href="/claims" />}
    </div>}
    {(policies || tasks || taskError) && <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]" data-dashboard-charts>
      {policies && <Card>
        <CardHeader>Written Premium - Last 12 Months</CardHeader>
        <CardBody>{policies.written_premium_series.some((item) => item.premium > 0)
          ? <PremiumChart series={policies.written_premium_series} />
          : <p className="py-12 text-center text-sm text-cui-muted">No written premium recorded in this period.</p>}</CardBody>
      </Card>}
      {(tasks || taskError) && <Card>
        <CardHeader actions={tasks ? <Link href="/tasks" className="text-xs font-semibold text-cui-primary hover:underline">View tasks</Link> : undefined}>Task timing</CardHeader>
        <CardBody>{taskError ? <p role="alert" className="py-12 text-center text-sm text-cui-danger">{taskError}{' '}
          <button type="button" className="underline" onClick={() => setTaskRevision((value) => value + 1)}>Retry task chart</button></p>
          : tasks && tasks.on_time + tasks.overdue + tasks.open + tasks.unclassified > 0 ? <TaskTimelinessChart metrics={tasks} />
          : <p className="py-12 text-center text-sm text-cui-muted">No tasks yet.</p>}</CardBody>
      </Card>}
    </div>}
    {policies && <Card>
      <CardHeader actions={<Link href="/renewals" className="text-xs font-semibold text-cui-primary hover:underline">View renewals</Link>}>Upcoming Renewals (30 Days)</CardHeader>
      <CardBody className="p-0">
        {renewalsLoading ? <p className="p-6 text-center text-sm text-cui-muted">Loading renewals...</p>
          : renewals?.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr className="border-b border-cui-border bg-cui-light text-xs uppercase text-cui-muted">{['Insured', 'Carrier', 'Line of business', 'Renewal date', 'Premium'].map((label) => <th key={label} className="px-4 py-2 font-semibold">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-cui-border/50">{renewals.map((renewal) => <tr key={renewal.id} className="hover:bg-cui-light/60">
            <td className="px-4 py-3 font-medium text-cui-text">{renewal.insured_name}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.carrier}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.line_of_business}</td>
            <td className="px-4 py-3 text-cui-muted">{renewal.renewal_date ?? renewal.expiration_date ?? '--'}</td>
            <td className="px-4 py-3 font-medium text-cui-text">{renewal.premium === null ? '--' : currency(Number(renewal.premium))}</td>
          </tr>)}</tbody>
        </table></div> : <p className="p-6 text-center text-sm text-cui-muted">{renewalsError ? 'Renewal data unavailable.' : 'No renewals due in the next 30 days.'}</p>}
      </CardBody>
    </Card>}
  </div></SectionLayout>;
}
