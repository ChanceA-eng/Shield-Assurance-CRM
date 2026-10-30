'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, CircleDollarSign, ShieldAlert, Users } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import StatWidget from '../components/ui/StatWidget';

interface MetricsResponse {
  total_written_premium: number;
  active_leads: number;
  lead_conversion_rate: number;
  renewals_30_days: number;
  open_claims: number;
}

interface RecentRecord {
  id: string;
  type: string;
  name: string;
  touchedAt: string;
}

interface TaskRow {
  id: string;
  subject: string;
  due_date: string | null;
  priority?: string | null;
  status?: string | null;
}

interface RenewalRow {
  id: string;
  insured_name: string;
  carrier: string;
  line_of_business: string;
  premium: number | string | null;
  renewal_date: string | null;
  expiration_date: string | null;
}

interface RenewalsResponse {
  counts?: { '30': number; '60': number; '90': number; overdue: number };
  items?: RenewalRow[];
}

interface PolicyRow {
  id: string;
  premium: number | string | null;
  effective_date: string | null;
}

interface BriefingResponse {
  overdue_tasks: number;
  today_tasks: Array<{ id: string; subject: string }>;
  unread_messages: number;
  pending_approvals: number;
  new_leads_24h: number;
  recent_replies: string[];
  stalled_leads: number;
  active_sequences: number;
  summary: string | null;
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) {
    const thousands = value / 1_000;
    const formatted = thousands >= 100 ? thousands.toFixed(0) : thousands.toFixed(1).replace(/\.0$/, '');
    return `$${formatted}K`;
  }
  return `$${Math.round(value).toLocaleString()}`;
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function prettyDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeTime(value: string): string {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return value;
  const minutes = Math.floor((Date.now() - date) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return prettyDate(value);
}

function buildPremiumSeries(policies: PolicyRow[]): Array<{ month: string; premium: number }> {
  const now = new Date();
  const buckets: Array<{ key: string; month: string; premium: number }> = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      month: d.toLocaleDateString(undefined, { month: 'short' }),
      premium: 0,
    });
  }

  for (const policy of policies) {
    if (!policy.effective_date) continue;
    const key = policy.effective_date.slice(0, 7);
    const bucket = buckets.find((b) => b.key === key);
    if (bucket) {
      bucket.premium += toNumber(policy.premium);
    }
  }

  return buckets.map(({ month, premium }) => ({ month, premium: Math.round(premium) }));
}

export default function DashboardPage(): JSX.Element {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [recent, setRecent] = useState<RecentRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [renewals, setRenewals] = useState<RenewalsResponse | null>(null);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The briefing loads separately: its AI summary can take a few seconds.
    void (async () => {
      const result = await safeJson<BriefingResponse>('/api/briefing');
      if (!cancelled) setBriefing(result);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      const [metricsRes, recentRes, tasksRes, renewalsRes, policiesRes] = await Promise.all([
        safeJson<MetricsResponse>('/api/metrics/home'),
        safeJson<RecentRecord[]>('/api/recent'),
        safeJson<TaskRow[]>('/api/tasks?status=open&sort=due_asc'),
        safeJson<RenewalsResponse>('/api/renewals?window=30'),
        safeJson<PolicyRow[]>('/api/policies'),
      ]);

      if (cancelled) return;
      setMetrics(metricsRes);
      setRecent(Array.isArray(recentRes) ? recentRes : []);
      setTasks(Array.isArray(tasksRes) ? tasksRes : []);
      setRenewals(renewalsRes);
      setPolicies(Array.isArray(policiesRes) ? policiesRes : []);
      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const premiumSeries = useMemo(() => buildPremiumSeries(policies), [policies]);
  const hasPremiumData = premiumSeries.some((point) => point.premium > 0);
  const conversionRate = metrics ? Math.round(metrics.lead_conversion_rate * 100) : 0;
  const renewalItems = (renewals?.items ?? []).slice(0, 8);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-cui-text">Dashboard</h1>
        <p className="mt-1 text-sm text-cui-muted">Live agency overview — all figures update from your book of business.</p>
      </div>

      {/* Morning briefing */}
      <Card>
        <CardHeader>Today&rsquo;s Briefing</CardHeader>
        <CardBody className="space-y-3">
          {!briefing ? (
            <p className="text-sm text-cui-muted">Pulling today&rsquo;s priorities…</p>
          ) : (
            <>
              {briefing.summary ? <p className="text-sm leading-relaxed text-cui-text">{briefing.summary}</p> : null}
              <div className="flex flex-wrap gap-2">
                {briefing.overdue_tasks > 0 ? (
                  <Link href="/tasks" className="rounded border border-cui-danger/40 bg-cui-danger/10 px-2.5 py-1 text-xs font-semibold text-cui-danger hover:bg-cui-danger/20">
                    {briefing.overdue_tasks} overdue {briefing.overdue_tasks === 1 ? 'task' : 'tasks'}
                  </Link>
                ) : null}
                <Link href="/tasks" className="rounded border border-cui-primary/40 bg-cui-primary/10 px-2.5 py-1 text-xs font-semibold text-cui-primary hover:bg-cui-primary/20">
                  {briefing.today_tasks.length} due today
                </Link>
                {briefing.unread_messages > 0 ? (
                  <Link href="/communication" className="rounded border border-cui-warning/50 bg-cui-warning/15 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-cui-warning/25">
                    {briefing.unread_messages} unread {briefing.unread_messages === 1 ? 'message' : 'messages'}
                  </Link>
                ) : null}
                {briefing.pending_approvals > 0 ? (
                  <Link href="/outreach" className="rounded border border-cui-info/40 bg-cui-info/10 px-2.5 py-1 text-xs font-semibold text-cui-info hover:bg-cui-info/20">
                    {briefing.pending_approvals} outreach {briefing.pending_approvals === 1 ? 'draft' : 'drafts'} to approve
                  </Link>
                ) : null}
                {briefing.new_leads_24h > 0 ? (
                  <Link href="/leads" className="rounded border border-cui-success/40 bg-cui-success/10 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-cui-success/20">
                    {briefing.new_leads_24h} new {briefing.new_leads_24h === 1 ? 'lead' : 'leads'} (24h)
                  </Link>
                ) : null}
                {briefing.recent_replies.length > 0 ? (
                  <Link href="/leads" className="rounded border border-cui-success/40 bg-cui-success/10 px-2.5 py-1 text-xs font-semibold text-green-700 hover:bg-cui-success/20">
                    Replies: {briefing.recent_replies.slice(0, 3).join(', ')}
                  </Link>
                ) : null}
                {briefing.stalled_leads > 0 ? (
                  <Link href="/leads?outcome=all" className="rounded border border-cui-border bg-cui-light px-2.5 py-1 text-xs font-semibold text-cui-muted hover:bg-cui-border/40">
                    {briefing.stalled_leads} stalled 7+ days
                  </Link>
                ) : null}
                {briefing.active_sequences > 0 ? (
                  <Link href="/outreach" className="rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-muted hover:bg-cui-light">
                    {briefing.active_sequences} {briefing.active_sequences === 1 ? 'sequence' : 'sequences'} running
                  </Link>
                ) : null}
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* Stat widgets */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatWidget
          label="Total Written Premium"
          value={loading ? '…' : formatCurrency(metrics?.total_written_premium ?? 0)}
          color="primary"
          icon={CircleDollarSign}
          href="/policies"
        />
        <StatWidget
          label="Active Leads"
          value={loading ? '…' : String(metrics?.active_leads ?? 0)}
          color="info"
          icon={Users}
          href="/leads"
          footer={
            <div>
              <div className="h-1.5 w-full overflow-hidden rounded bg-white/30">
                <div className="h-full rounded bg-white" style={{ width: `${Math.min(conversionRate, 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-white/80">{conversionRate}% lead conversion</p>
            </div>
          }
        />
        <StatWidget
          label="Renewals (30 Days)"
          value={loading ? '…' : String(metrics?.renewals_30_days ?? 0)}
          color="warning"
          icon={CalendarClock}
          href="/renewals"
        />
        <StatWidget
          label="Open Claims"
          value={loading ? '…' : String(metrics?.open_claims ?? 0)}
          color="danger"
          icon={ShieldAlert}
          href="/claims"
        />
      </div>

      {/* Premium trend */}
      <Card>
        <CardHeader
          actions={
            <Link href="/policies" className="text-xs font-semibold text-cui-primary hover:underline">
              View policies
            </Link>
          }
        >
          Written Premium — Last 12 Months
        </CardHeader>
        <CardBody>
          {hasPremiumData ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={premiumSeries} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="premiumFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#20a8d8" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#20a8d8" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e5e6" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#73818f' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 12, fill: '#73818f' }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value: number) => formatCurrency(value)}
                    width={64}
                  />
                  <Tooltip formatter={(value) => [formatCurrency(toNumber(value as number)), 'Premium']} />
                  <Area type="monotone" dataKey="premium" stroke="#20a8d8" strokeWidth={2} fill="url(#premiumFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="py-10 text-center text-sm text-cui-muted">
              {loading ? 'Loading premium data…' : 'No policies with premium recorded in the last 12 months yet.'}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Activity + tasks */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>Recent Activity</CardHeader>
          <CardBody className="p-0">
            {recent.length === 0 ? (
              <p className="p-6 text-center text-sm text-cui-muted">
                {loading ? 'Loading activity…' : 'No recent clients or policies yet. Create your first client to get started.'}
              </p>
            ) : (
              <ul className="divide-y divide-cui-border/40">
                {recent.map((record) => (
                  <li key={`${record.type}-${record.id}`} className="flex items-center gap-3 px-4 py-2.5">
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                        record.type === 'Client' ? 'bg-cui-info/15 text-cui-info' : 'bg-cui-primary/15 text-cui-primary'
                      }`}
                    >
                      {record.type}
                    </span>
                    <span className="flex-1 truncate text-sm text-cui-text">{record.name}</span>
                    <span className="shrink-0 text-xs text-cui-muted">{relativeTime(record.touchedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            actions={
              <Link href="/tasks" className="text-xs font-semibold text-cui-primary hover:underline">
                View all
              </Link>
            }
          >
            Open Tasks
          </CardHeader>
          <CardBody className="p-0">
            {tasks.length === 0 ? (
              <p className="p-6 text-center text-sm text-cui-muted">
                {loading ? 'Loading tasks…' : 'No open tasks. Nice work.'}
              </p>
            ) : (
              <ul className="divide-y divide-cui-border/40">
                {tasks.slice(0, 7).map((task) => (
                  <li key={task.id} className="px-4 py-2.5">
                    <p className="truncate text-sm text-cui-text">{task.subject}</p>
                    <p className="mt-0.5 text-xs text-cui-muted">Due {prettyDate(task.due_date)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Upcoming renewals */}
      <Card>
        <CardHeader
          actions={
            <Link href="/renewals" className="text-xs font-semibold text-cui-primary hover:underline">
              View all renewals
            </Link>
          }
        >
          Upcoming Renewals (30 Days)
        </CardHeader>
        <CardBody className="p-0">
          {renewalItems.length === 0 ? (
            <p className="p-6 text-center text-sm text-cui-muted">
              {loading ? 'Loading renewals…' : 'No renewals due in the next 30 days.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-cui-border/60 bg-cui-light text-xs uppercase tracking-wide text-cui-muted">
                    <th className="px-4 py-2 font-semibold">Insured</th>
                    <th className="px-4 py-2 font-semibold">Carrier</th>
                    <th className="px-4 py-2 font-semibold">Line of Business</th>
                    <th className="px-4 py-2 font-semibold">Renewal Date</th>
                    <th className="px-4 py-2 text-right font-semibold">Premium</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cui-border/40">
                  {renewalItems.map((renewal) => (
                    <tr key={renewal.id} className="hover:bg-cui-light/60">
                      <td className="px-4 py-2.5 font-medium text-cui-text">{renewal.insured_name}</td>
                      <td className="px-4 py-2.5 text-cui-muted">{renewal.carrier}</td>
                      <td className="px-4 py-2.5 text-cui-muted">{renewal.line_of_business}</td>
                      <td className="px-4 py-2.5 text-cui-muted">{prettyDate(renewal.renewal_date ?? renewal.expiration_date)}</td>
                      <td className="px-4 py-2.5 text-right font-medium text-cui-text">
                        {formatCurrency(toNumber(renewal.premium))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
