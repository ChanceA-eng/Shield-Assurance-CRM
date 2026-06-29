'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import SidebarNav from './SidebarNav';

interface MetricsResponse {
  mtd_written_premium: number;
  active_leads: number;
  lead_conversion_rate: number;
  renewals_30_days: number;
  open_claims: number;
}

interface Lead {
  id: string;
  full_name: string;
  source: string;
  line_of_business: string;
  status: string;
  created_at: string;
}

interface Task {
  id: string;
  subject: string;
  due_date: string;
}

interface EventItem {
  id: string;
  subject?: string;
  title?: string;
  event_date: string;
  event_time?: string | null;
  all_day?: boolean | null;
}

interface RenewalPolicy {
  id: string;
  insured_name: string;
  carrier: string;
  line_of_business: string;
  renewal_date: string;
  premium: number;
}

interface Claim {
  id: string;
  status: string;
  type: string;
  clients?: { full_name?: string } | null;
}

interface Endorsement {
  id: string;
  status: string;
  type: string;
}

interface Certificate {
  id: string;
  status: string;
  certificate_holder: string;
}

interface RenewalsResponse {
  counts: {
    '30': number;
    '60': number;
    '90': number;
    overdue: number;
  };
  items: RenewalPolicy[];
}

interface RecentRecord {
  id: string;
  type: string;
  name: string;
  touchedAt: string;
}

interface NotificationItem {
  id: string;
  type: string;
  message: string;
  read?: boolean | null;
  created_at?: string;
}

interface Suggestion {
  id: string;
  title: string;
  hint: string;
  href: DashboardHref;
}

type CollapsibleKey = 'leads' | 'renewals' | 'service';
type DashboardHref = '/' | '/leads' | '/policies' | '/tasks' | '/certificates' | '/claims' | '/endorsements' | '/renewals' | '/clients' | '/events';

interface KpiCard {
  label: string;
  value: string;
  trend: string;
  trendUp: boolean;
  href: DashboardHref;
  icon: string;
  accent: string;
  ring: string;
}

function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

function daysUntil(dateInput: string): number {
  const today = startOfToday().getTime();
  const target = new Date(dateInput).getTime();
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function prettyDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function relativeTime(value: string): string {
  const now = Date.now();
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return value;

  const deltaMs = now - date;
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return prettyDate(value);
}

function dateOnly(value: string): string {
  return value.slice(0, 10);
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
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

export default function SalesforceCompleteDashboard(): JSX.Element {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [renewals, setRenewals] = useState<RenewalPolicy[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [endorsements, setEndorsements] = useState<Endorsement[]>([]);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [recent, setRecent] = useState<RecentRecord[]>([]);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Record<CollapsibleKey, boolean>>({
    leads: false,
    renewals: false,
    service: false,
  });

  const suggestions: Suggestion[] = [
    { id: 'cert-upload', title: 'Upload your first certificate', hint: 'Issue COIs faster from one place.', href: '/certificates' },
    { id: 'new-policy', title: 'Add a new policy', hint: 'Policies power renewals and servicing.', href: '/policies' },
    { id: 'claims-followup', title: 'Follow up on open claims', hint: 'Keep claim status updated for retention.', href: '/claims' },
    { id: 'review-renewals', title: 'Review upcoming renewals', hint: 'Catch risk before expiration.', href: '/renewals' },
    { id: 'new-client', title: 'Add a new client', hint: 'Manual fallback for walk-in business.', href: '/clients' },
  ];

  const visibleSuggestions = suggestions.filter((item) => !dismissedSuggestions.includes(item.id));

  const newLeadsCount = leads.filter((lead) => lead.status.toLowerCase() === 'new').length;
  const workingLeadsCount = leads.filter((lead) => lead.status.toLowerCase() === 'working').length;
  const staleLeadsCount = leads.filter((lead) => {
    const status = lead.status.toLowerCase();
    return (status === 'new' || status === 'working' || status === 'quoted') && daysUntil(lead.created_at) < -7;
  }).length;

  const renewal0To30 = renewals.filter((policy) => {
    const days = daysUntil(policy.renewal_date);
    return days >= 0 && days <= 30;
  }).length;
  const renewal31To60 = renewals.filter((policy) => {
    const days = daysUntil(policy.renewal_date);
    return days >= 31 && days <= 60;
  }).length;
  const renewal61To90 = renewals.filter((policy) => {
    const days = daysUntil(policy.renewal_date);
    return days >= 61 && days <= 90;
  }).length;

  const pendingCertificates = certificates.filter((cert) => cert.status.toLowerCase() === 'pending').length;

  const today = todayISO();

  const myDayItems = [
    ...events
      .filter((event) => dateOnly(event.event_date) === today)
      .map((event) => ({
        id: `event-${event.id}`,
        type: 'Event',
        title: event.title ?? event.subject ?? 'Untitled event',
        time: event.all_day ? 'All day' : event.event_time || 'Scheduled',
      })),
    ...tasks
      .filter((task) => (task.due_date ? dateOnly(task.due_date) === today : false))
      .map((task) => ({
        id: `task-${task.id}`,
        type: 'Task',
        title: task.subject,
        time: 'Due today',
      })),
  ];

  const kpiCards: KpiCard[] = [
    {
      label: 'MTD Premium',
      value: metrics ? `$${metrics.mtd_written_premium.toLocaleString()}` : '--',
      trend: '+8.2%',
      trendUp: true,
      href: '/policies',
      icon: 'MP',
      accent: 'from-sky-500/25 to-cyan-500/10',
      ring: 'ring-sky-200',
    },
    {
      label: 'Active Leads',
      value: metrics ? metrics.active_leads.toLocaleString() : '--',
      trend: '+3 today',
      trendUp: true,
      href: '/leads',
      icon: 'AL',
      accent: 'from-emerald-500/25 to-green-500/10',
      ring: 'ring-emerald-200',
    },
    {
      label: 'Renewals (30 Days)',
      value: metrics ? metrics.renewals_30_days.toLocaleString() : '--',
      trend: `${renewal31To60} in 31-60d`,
      trendUp: true,
      href: '/renewals',
      icon: 'RN',
      accent: 'from-amber-500/25 to-yellow-500/10',
      ring: 'ring-amber-200',
    },
    {
      label: 'Open Claims',
      value: metrics ? metrics.open_claims.toLocaleString() : '--',
      trend: claims.length > 0 ? `${claims.length} active` : 'No open claims',
      trendUp: false,
      href: '/claims',
      icon: 'CL',
      accent: 'from-rose-500/25 to-red-500/10',
      ring: 'ring-rose-200',
    },
    {
      label: 'Open Endorsements',
      value: endorsements.length.toLocaleString(),
      trend: pendingCertificates > 0 ? `${pendingCertificates} pending certs` : 'No pending certs',
      trendUp: pendingCertificates === 0,
      href: '/endorsements',
      icon: 'EN',
      accent: 'from-violet-500/25 to-indigo-500/10',
      ring: 'ring-violet-200',
    },
  ];

  useEffect(() => {
    void (async () => {
      const [metricsData, leadsData, tasksData, eventsData, renewalsData, claimsData, endorsementsData, certificatesData, notificationsData, recentData] =
        await Promise.all([
        safeJson<MetricsResponse>('/api/metrics/home'),
        safeJson<Lead[]>('/api/leads?owner=me&status=open'),
        safeJson<Task[]>('/api/tasks?owner=me&due=today'),
        safeJson<EventItem[]>('/api/events?owner=me&date=today'),
        safeJson<RenewalsResponse>('/api/renewals?window=90'),
        safeJson<Claim[]>('/api/claims?status=open'),
        safeJson<Endorsement[]>('/api/endorsements?status=open'),
        safeJson<Certificate[]>('/api/certificates?status=all'),
        safeJson<NotificationItem[]>('/api/notifications?read=false'),
        safeJson<RecentRecord[]>('/api/recent?owner=me'),
      ]);

      setMetrics(metricsData);
      setLeads(leadsData ?? []);
      setTasks(tasksData ?? []);
      setEvents(eventsData ?? []);
      setRenewals(renewalsData?.items ?? []);
      setClaims(claimsData ?? []);
      setEndorsements(endorsementsData ?? []);
      setCertificates(certificatesData ?? []);
      setNotifications(notificationsData ?? []);
      setRecent(recentData ?? []);
    })();
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#edf2f8] font-sans text-[#0d1b2a] antialiased">
      <SidebarNav />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="relative border-b border-[#d6deea] bg-gradient-to-r from-[#0d4f8c] via-[#275f9f] to-[#3f5ea8] px-5 py-4 text-white">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.28),transparent_45%)]" />
          <div className="relative flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/25 bg-white/15 px-4 py-4 backdrop-blur-lg">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-100">Shield Assurance CRM</p>
              <h1 className="text-2xl font-semibold tracking-tight">Welcome back, Chance</h1>
              <p className="mt-1 text-xs text-blue-100">{new Date().toLocaleDateString()} · Your agency at a glance</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Link
                href="/leads"
                className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-[#0b4b82] shadow transition hover:-translate-y-0.5"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#d8ecff] text-[10px]">NL</span>
                New Lead
              </Link>
              <Link
                href="/policies"
                className="inline-flex items-center gap-2 rounded-full bg-[#e6fff3] px-3 py-2 text-xs font-semibold text-[#046640] shadow transition hover:-translate-y-0.5"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#c7f6e0] text-[10px]">NP</span>
                New Policy
              </Link>
              <Link
                href="/tasks"
                className="inline-flex items-center gap-2 rounded-full bg-[#fff6df] px-3 py-2 text-xs font-semibold text-[#8a4d00] shadow transition hover:-translate-y-0.5"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ffe7ac] text-[10px]">NT</span>
                New Task
              </Link>
              <Link
                href="/certificates"
                className="inline-flex items-center gap-2 rounded-full bg-[#f1ebff] px-3 py-2 text-xs font-semibold text-[#4f2f9d] shadow transition hover:-translate-y-0.5"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#e4d7ff] text-[10px]">UC</span>
                Upload Certificate
              </Link>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            {kpiCards.map((card) => (
              <Link
                key={card.label}
                href={card.href}
                className={`group relative overflow-hidden rounded-2xl border border-white/80 bg-white p-4 shadow-sm ring-1 ${card.ring} transition hover:-translate-y-1 hover:shadow-lg`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${card.accent} opacity-70 transition group-hover:opacity-100`} />
                <div className="relative">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#516680]">{card.label}</p>
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-[10px] font-bold text-[#174068]">
                      {card.icon}
                    </span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-[#10273f]">{card.value}</p>
                  <p className={`mt-1 text-[11px] font-semibold ${card.trendUp ? 'text-[#0f7a4b]' : 'text-[#a33d3d]'}`}>
                    {card.trendUp ? 'UP' : 'DOWN'} {card.trend}
                  </p>
                </div>
              </Link>
            ))}
          </section>

          {visibleSuggestions.length > 0 ? (
            <section className="mt-4 rounded-2xl border border-[#dce6f3] bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0f2943]">Suggested Next Steps</h2>
                <span className="text-xs text-[#60748a]">Dismiss cards as you complete actions</span>
              </div>
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-5">
                {visibleSuggestions.map((item) => (
                  <article key={item.id} className="rounded-xl border border-[#e5edf8] bg-[#f8fbff] p-3">
                    <p className="text-sm font-semibold text-[#16324d]">{item.title}</p>
                    <p className="mt-1 text-xs text-[#63798e]">{item.hint}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <Link href={item.href} className="text-xs font-semibold text-[#0f62af] hover:underline">
                        Open
                      </Link>
                      <button
                        type="button"
                        className="text-xs text-[#7d8797] hover:text-[#2f3a49]"
                        onClick={() => setDismissedSuggestions((prev) => [...prev, item.id])}
                      >
                        Dismiss
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0f2943]">Today's Tasks</h2>
                <Link href="/tasks" className="text-xs font-semibold text-[#0f62af] hover:underline">
                  View all
                </Link>
              </div>
              {tasks.length === 0 ? <p className="text-sm text-[#6b7d90]">No tasks due today.</p> : null}
              <ul className="space-y-2">
                {tasks.map((task) => {
                  const urgency = daysUntil(task.due_date) < 0 ? 'Overdue' : daysUntil(task.due_date) === 0 ? 'Today' : 'Upcoming';
                  const urgencyClass = urgency === 'Overdue' ? 'bg-[#ffe6e6] text-[#9f2f2f]' : urgency === 'Today' ? 'bg-[#fff0d8] text-[#8a4d00]' : 'bg-[#e8f4ff] text-[#0a4f8f]';

                  return (
                    <li key={task.id} className="flex items-start gap-3 rounded-xl border border-[#e8eef7] bg-[#fbfdff] p-3 text-sm">
                      <input type="checkbox" className="mt-1 h-4 w-4 rounded border-[#b4c4d9]" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-semibold text-[#122e49]">{task.subject}</p>
                        <p className="text-xs text-[#667b90]">Due {prettyDate(task.due_date)}</p>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${urgencyClass}`}>{urgency}</span>
                    </li>
                  );
                })}
              </ul>
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0f2943]">Today's Events</h2>
                <Link href="/events" className="text-xs font-semibold text-[#0f62af] hover:underline">
                  View all
                </Link>
              </div>
              {events.length === 0 ? <p className="text-sm text-[#6b7d90]">No events scheduled.</p> : null}
              <ul className="space-y-2">
                {events.map((event) => (
                  <li key={event.id} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#122e49]">{event.subject}</p>
                        <p className="text-xs text-[#667b90]">{prettyDate(event.event_date)} · Agency Calendar</p>
                      </div>
                      <div className="flex gap-1">
                        <button type="button" className="rounded bg-[#e7f2ff] px-2 py-1 text-[10px] font-semibold text-[#0a4f8f]">
                          Join
                        </button>
                        <button type="button" className="rounded bg-[#eef3f8] px-2 py-1 text-[10px] font-semibold text-[#425468]">
                          Call
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          </section>

          <section className="mt-4 rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#0f2943]">My Day Timeline</h2>
              <Link href="/scheduler" className="text-xs font-semibold text-[#0f62af] hover:underline">
                Open Scheduler
              </Link>
            </div>
            {myDayItems.length === 0 ? <p className="text-sm text-[#6b7d90]">No events or tasks due today.</p> : null}
            <ul className="space-y-2">
              {myDayItems.map((item) => (
                <li key={item.id} className="flex items-center justify-between rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-[#122e49]">{item.title}</p>
                    <p className="text-xs text-[#667b90]">{item.type}</p>
                  </div>
                  <span className="text-xs font-semibold text-[#425f7b]">{item.time}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0f2943]">Leads Needing Attention</h2>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#0f62af] hover:underline"
                  onClick={() => setCollapsed((prev) => ({ ...prev, leads: !prev.leads }))}
                >
                  {collapsed.leads ? 'Expand' : 'Collapse'}
                </button>
              </div>
              {!collapsed.leads ? (
                <>
                  <div className="mb-3 grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-lg bg-[#e8f4ff] px-2 py-2 font-semibold text-[#0a4f8f]">New {newLeadsCount}</div>
                    <div className="rounded-lg bg-[#e9f8ef] px-2 py-2 font-semibold text-[#1f7a47]">Working {workingLeadsCount}</div>
                    <div className="rounded-lg bg-[#fff0de] px-2 py-2 font-semibold text-[#8a4d00]">Stale {staleLeadsCount}</div>
                  </div>
                  <ul className="space-y-2">
                    {leads.slice(0, 4).map((lead) => (
                      <li key={lead.id} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2 text-xs">
                        <p className="font-semibold text-[#0f62af]">{lead.full_name}</p>
                        <p className="mt-0.5 text-[#667b90]">
                          {lead.line_of_business || 'General'} · {lead.status} · {lead.source || 'Unknown Source'}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0f2943]">Renewal Radar</h2>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#0f62af] hover:underline"
                  onClick={() => setCollapsed((prev) => ({ ...prev, renewals: !prev.renewals }))}
                >
                  {collapsed.renewals ? 'Expand' : 'Collapse'}
                </button>
              </div>
              {!collapsed.renewals ? (
                <>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <Link href="/renewals" className="rounded-lg bg-[#e9f6ff] px-2 py-2 font-semibold text-[#0a4f8f] hover:opacity-90">
                      0-30d {renewal0To30}
                    </Link>
                    <Link href="/renewals" className="rounded-lg bg-[#fff3de] px-2 py-2 font-semibold text-[#8a4d00] hover:opacity-90">
                      31-60d {renewal31To60}
                    </Link>
                    <Link href="/renewals" className="rounded-lg bg-[#f3edff] px-2 py-2 font-semibold text-[#4f2f9d] hover:opacity-90">
                      61-90d {renewal61To90}
                    </Link>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {renewals.slice(0, 4).map((policy) => (
                      <li key={policy.id} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2 text-xs">
                        <p className="font-semibold text-[#16324d]">{policy.insured_name || 'Unknown Insured'}</p>
                        <p className="mt-0.5 text-[#667b90]">
                          {policy.line_of_business} · {prettyDate(policy.renewal_date)} · ${policy.premium.toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </article>

            <article className="rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[#0f2943]">Service Queue</h2>
                <button
                  type="button"
                  className="text-xs font-semibold text-[#0f62af] hover:underline"
                  onClick={() => setCollapsed((prev) => ({ ...prev, service: !prev.service }))}
                >
                  {collapsed.service ? 'Expand' : 'Collapse'}
                </button>
              </div>
              {!collapsed.service ? (
                <div className="space-y-2 text-xs">
                  <Link href="/claims" className="flex items-center justify-between rounded-lg bg-[#ffe8e8] px-3 py-2 font-semibold text-[#9f2f2f]">
                    <span>Open Claims</span>
                    <span>{claims.length}</span>
                  </Link>
                  <Link
                    href="/endorsements"
                    className="flex items-center justify-between rounded-lg bg-[#f1ebff] px-3 py-2 font-semibold text-[#4f2f9d]"
                  >
                    <span>Open Endorsements</span>
                    <span>{endorsements.length}</span>
                  </Link>
                  <Link
                    href="/certificates"
                    className="flex items-center justify-between rounded-lg bg-[#e8f4ff] px-3 py-2 font-semibold text-[#0a4f8f]"
                  >
                    <span>Pending Certificates</span>
                    <span>{pendingCertificates}</span>
                  </Link>
                </div>
              ) : null}
            </article>
          </section>

          <section className="mt-4 rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#0f2943]">Operations Log</h2>
              <span className="text-xs text-[#6b7d90]">Agency-wide automation and service events</span>
            </div>
            {notifications.length === 0 ? <p className="text-sm text-[#6b7d90]">No new alerts.</p> : null}
            <ul className="space-y-2">
              {notifications.slice(0, 5).map((notification) => (
                <li
                  key={notification.id}
                  className={`rounded-xl border px-3 py-2 text-sm ${notification.read ? 'border-[#e8eef7] bg-[#fbfdff]' : 'border-[#cfe4ff] bg-[#eef6ff]'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#14324f]">{notification.message}</p>
                      <p className="text-xs text-[#667b90]">{notification.type}</p>
                    </div>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-[#0a4f8f]">
                      {notification.read ? 'Read' : 'New'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-4 rounded-2xl border border-[#dce6f3] bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[#0f2943]">Recent Activity Feed</h2>
              <span className="text-xs text-[#6b7d90]">Live from clients, policies, leads, claims, certificates</span>
            </div>

            {recent.length === 0 ? <p className="text-sm text-[#6b7d90]">No recent activity yet.</p> : null}

            <ul className="space-y-2">
              {recent.map((record) => {
                const type = record.type.toLowerCase();
                const href: DashboardHref =
                  type === 'lead'
                    ? '/leads'
                    : type === 'policy'
                      ? '/policies'
                      : type === 'client'
                        ? '/clients'
                        : type === 'claim'
                          ? '/claims'
                          : type === 'certificate'
                            ? '/certificates'
                            : '/';

                return (
                  <li key={`${record.type}-${record.id}`}>
                    <Link
                      href={href}
                      className="flex items-center justify-between rounded-xl border border-[#e8eef7] bg-[#fbfdff] px-3 py-2 hover:bg-[#f1f7ff]"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[#14324f]">{record.name}</p>
                        <p className="text-xs text-[#667b90]">{record.type}</p>
                      </div>
                      <p className="text-xs font-medium text-[#587189]">{relativeTime(record.touchedAt)}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
