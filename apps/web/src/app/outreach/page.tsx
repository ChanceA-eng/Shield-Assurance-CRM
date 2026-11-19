'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { Inbox, Mail, Pause, Play, RefreshCw, Send, UserX, X } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { activityFilters, DeliveryState } from './DeliveryState';
import type { OutreachSender, SalesTemplateSnapshot } from '@crm/shared';
import { outreachQualityIssues } from '../../lib/outreach-quality';
import AgentOutreachSettings from '../../components/crm/AgentOutreachSettings';
import EmailDesignPreview from '../../components/crm/EmailDesignPreview';

interface OutreachSettings {
  approval_mode: boolean;
  daily_send_cap: number;
  send_window_start: number;
  send_window_end: number;
  opt_out_footer: string;
  sender_profile: OutreachSender;
}

interface PendingItem {
  id: string;
  lead_id: string;
  lead_name: string;
  step_number: number;
  to_email: string;
  subject: string;
  body: string;
  cited_signals: string[];
  created_at: string;
  draft_revision: number;
  sales_template?: SalesTemplateSnapshot | null;
}

interface EnrollmentItem {
  id: string;
  lead_id: string;
  lead_name: string;
  lead_status: string | null;
  status: string;
  current_step: number;
  total_steps: number;
  next_send_at: string | null;
  enrolled_at: string;
}

interface RecentItem {
  id: string;
  lead_id: string;
  lead_name: string;
  step_number: number;
  subject: string;
  status: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

interface OverviewPayload {
  settings: OutreachSettings;
  agent_outreach_enabled?: boolean;
  sent_today: number;
  pending: PendingItem[];
  enrollments: EnrollmentItem[];
  recent: RecentItem[];
  opt_outs: number;
}

function prettyDateTime(value: string | null | undefined): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function StatTile({ label, value, tone }: { label: string; value: string; tone: string }): JSX.Element {
  return (
    <div className={`rounded border px-4 py-3 ${tone}`}>
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide opacity-80">{label}</p>
    </div>
  );
}

export default function OutreachPage(): JSX.Element {
  return <Suspense fallback={<p className="p-6 text-sm text-cui-muted">Loading outreach...</p>}><OutreachContent /></Suspense>;
}

function OutreachContent(): JSX.Element {
  const attempt = useSearchParams().get('attempt');
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState('all');

  // Per-item edit drafts for pending approvals.
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rewriteId, setRewriteId] = useState<string | null>(null);
  const [rewriteInstructions, setRewriteInstructions] = useState<Record<string, string>>({});
  const [isRewriting, setIsRewriting] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const load = useCallback(async (clearError = true): Promise<void> => {
    try {
      const params = new URLSearchParams({ recent_status: activityFilter });
      if (attempt) params.set('attempt', attempt);
      const res = await fetch(`/api/outreach?${params}`, { cache: 'no-store' });
      if (!res.ok) {
        setData(null);
        setError('Outreach data could not be loaded. Refresh the page to try again.');
        return;
      }
      const payload = (await res.json()) as OverviewPayload;
      setData(payload);
      if (clearError) setError(null);
    } catch {
      setData(null);
      setError('Outreach data could not be loaded. Refresh the page to try again.');
    } finally {
      setIsLoading(false);
    }
  }, [activityFilter, attempt]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (attempt && data) document.getElementById(`attempt-${attempt}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [attempt, data]);

  const editFor = (item: PendingItem): { subject: string; body: string } =>
    edits[item.id] ?? { subject: item.subject, body: item.body };

  const actOnOutbox = async (item: PendingItem, action: 'approve_send' | 'reject'): Promise<void> => {
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const draft = editFor(item);
      const res = await fetch(`/api/outreach/outbox/${encodeURIComponent(item.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'approve_send' ? { action, subject: draft.subject, body: draft.body, revision: item.draft_revision } : { action },
        ),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? 'Action failed.');
        return;
      }
      setNotice(action === 'approve_send' ? `Accepted by provider for ${item.lead_name}; delivery is not confirmed.` : 'Draft rejected.');
    } catch {
      setError('Action failed.');
    } finally {
      // A failed HTTP response can follow provider acceptance. Never leave a stale
      // approval button enabled without refreshing the persistent attempt state.
      await load(false);
      setBusyId(null);
    }
  };

  const rewriteDraft = async (item: PendingItem): Promise<void> => {
    setBusyId(item.id);
    setIsRewriting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/outreach/outbox/${encodeURIComponent(item.id)}/rewrite`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editFor(item), instruction: rewriteInstructions[item.id], revision: item.draft_revision }),
      });
      if (!response.ok) {
        const failure = await response.json() as { message?: string };
        throw new Error(failure.message ?? 'Rewrite failed. Your original draft was not changed.');
      }
      const draft = await response.json() as Pick<PendingItem, 'subject' | 'body' | 'cited_signals' | 'draft_revision'>;
      setData((current) => current ? { ...current, pending: current.pending.map((row) => row.id === item.id ? { ...row, ...draft } : row) } : current);
      setEdits((current) => ({ ...current, [item.id]: { subject: draft.subject, body: draft.body } }));
      setRewriteId(null);
      setRewriteInstructions((current) => ({ ...current, [item.id]: '' }));
      setNotice('Rewritten draft saved for your review. Nothing was sent; approve it when ready.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Rewrite failed. Your original draft was not changed.');
    } finally {
      setBusyId(null);
      setIsRewriting(false);
    }
  };

  const finishRecording = async (item: RecentItem): Promise<void> => {
    if (item.status !== 'accepted_by_provider') return;
    setBusyId(item.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/outreach/outbox/${encodeURIComponent(item.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'finish_recording' }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string };
      if (!response.ok) throw new Error(payload.message ?? 'Could not finish recording provider acceptance.');
      setNotice('Provider acceptance recorded. No email was resent; delivery is not confirmed.');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Recording failed. No resend was requested.');
    } finally {
      await load(false);
      setBusyId(null);
    }
  };

  const actOnEnrollment = async (enrollment: EnrollmentItem, action: 'pause' | 'resume' | 'cancel'): Promise<void> => {
    setBusyId(enrollment.id);
    setError(null);
    try {
      const res = await fetch(`/api/outreach/enrollments/${encodeURIComponent(enrollment.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? 'Action failed.');
        return;
      }
      await load();
    } catch {
      setError('Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const runEngine = async (): Promise<void> => {
    setIsRunning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/outreach/run', { method: 'POST' });
      if (!res.ok) {
        setError('Engine run failed.');
        return;
      }
      const result = (await res.json()) as { drafted: number; autoSent: number; skipped: number };
      setNotice(`Engine run complete: ${result.drafted} drafted, ${result.autoSent} accepted by provider, ${result.skipped} skipped. Delivery is not confirmed.`);
      await load();
    } catch {
      setError('Engine run failed.');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <SectionLayout title="Outreach">
      <div className="mx-auto max-w-5xl space-y-4">
        {error ? (
          <div className="rounded border border-cui-danger/40 bg-cui-danger/10 px-3 py-2 text-sm text-cui-danger">{error}</div>
        ) : null}
        {notice ? (
          <div role="status" className="rounded border border-cui-success/40 bg-cui-success/10 px-3 py-2 text-sm text-green-700">{notice}</div>
        ) : null}

        {/* Stats + engine run */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Awaiting approval"
            value={String(data?.pending.length ?? '--')}
            tone="border-cui-warning/40 bg-cui-warning/10 text-amber-800"
          />
          <StatTile
            label="Active sequences"
            value={String(data?.enrollments.filter((enrollment) => enrollment.status === 'active').length ?? '--')}
            tone="border-cui-primary/40 bg-cui-primary/10 text-cui-primary"
          />
          <StatTile
            label="Daily send slots used"
            value={data ? `${data.sent_today} / ${data.settings.daily_send_cap}` : '--'}
            tone="border-cui-success/40 bg-cui-success/10 text-green-700"
          />
          <StatTile
            label="Opt-outs honored"
            value={String(data?.opt_outs ?? '--')}
            tone="border-cui-border bg-white text-cui-muted"
          />
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded border border-cui-border bg-white px-3 py-1.5 text-sm font-semibold text-cui-text transition hover:bg-cui-light"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void runEngine()}
            disabled={isRunning}
            className="inline-flex items-center gap-1.5 rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-cui-primary/90 disabled:opacity-60"
          >
            <Play className="h-3.5 w-3.5" />
            {isRunning ? 'Running…' : 'Run engine now'}
          </button>
        </div>

        {/* Approval outbox */}
        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-1.5">
              <Inbox className="h-4 w-4 text-cui-primary" />
              Outbox — drafts awaiting your approval ({data?.pending.length ?? 0})
            </span>
          </CardHeader>
          <CardBody className="space-y-4">
            {isLoading ? <p className="text-sm text-cui-muted">Loading…</p> : null}
            {!isLoading && (data?.pending.length ?? 0) === 0 ? (
              <p className="rounded border border-dashed border-cui-border/80 p-4 text-center text-sm text-cui-muted">
                Nothing waiting. Enroll a lead from its profile drawer (Overview tab) or run the engine to draft due steps.
              </p>
            ) : null}
            {(data?.pending ?? []).map((item) => {
              const draft = editFor(item);
              return (
                <div key={item.id} id={`attempt-${item.id}`} className={`rounded border ${item.id === attempt ? 'border-cui-primary ring-2 ring-cui-primary/30' : 'border-cui-border/60'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cui-border/40 bg-cui-light px-3 py-2">
                    <div className="min-w-0 text-sm">
                      <Link
                        href={`/leads?lead=${item.lead_id}` as Route}
                        className="font-bold text-cui-primary hover:underline"
                      >
                        {item.lead_name}
                      </Link>
                      <span className="ml-2 text-xs text-cui-muted">
                        Email {item.step_number} · to {item.to_email} · drafted {prettyDateTime(item.created_at)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setRewriteId(rewriteId === item.id ? null : item.id)}
                        disabled={busyId !== null}
                        aria-expanded={rewriteId === item.id}
                        className="inline-flex items-center gap-1 rounded border border-cui-primary bg-white px-2.5 py-1 text-xs font-semibold text-cui-primary hover:bg-cui-primary/10 disabled:opacity-60"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Rewrite with AI
                      </button>
                      <button
                        type="button"
                        onClick={() => void actOnOutbox(item, 'reject')}
                        disabled={busyId !== null}
                        className="inline-flex items-center gap-1 rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-muted transition hover:text-cui-danger disabled:opacity-60"
                      >
                        <X className="h-3 w-3" />
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => void actOnOutbox(item, 'approve_send')}
                        disabled={busyId !== null}
                        className="inline-flex items-center gap-1 rounded bg-cui-success px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-cui-success/90 disabled:opacity-60"
                      >
                        <Send className="h-3 w-3" />
                        {busyId === item.id && !isRewriting ? 'Processing…' : 'Approve and send'}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2 p-3">
                    <input
                      type="text"
                      aria-label={`Draft subject for ${item.lead_name}`}
                      disabled={busyId === item.id}
                      value={draft.subject}
                      onChange={(event) => setEdits((prev) => ({ ...prev, [item.id]: { ...draft, subject: event.target.value } }))}
                      className="w-full rounded border border-cui-border px-2.5 py-1.5 text-sm font-semibold focus:border-cui-primary focus:outline-none"
                    />
                    <textarea
                      aria-label={`Draft body for ${item.lead_name}`}
                      disabled={busyId === item.id}
                      value={draft.body}
                      onChange={(event) => setEdits((prev) => ({ ...prev, [item.id]: { ...draft, body: event.target.value } }))}
                      rows={Math.min(12, Math.max(5, draft.body.split('\n').length + 1))}
                      className="w-full rounded border border-cui-border px-2.5 py-1.5 text-sm leading-relaxed focus:border-cui-primary focus:outline-none"
                    />
                    {item.sales_template?.email_design ? <EmailDesignPreview body={draft.body} design={item.sales_template.email_design} /> : null}
                    {rewriteId === item.id ? (
                      <div className="space-y-2 rounded border border-cui-primary/30 bg-cui-primary/5 p-3">
                        <label className="block text-xs font-semibold" htmlFor={`rewrite-${item.id}`}>Rewrite instructions</label>
                        <textarea
                          id={`rewrite-${item.id}`}
                          value={rewriteInstructions[item.id] ?? ''}
                          onChange={(event) => setRewriteInstructions((current) => ({ ...current, [item.id]: event.target.value }))}
                          maxLength={1000}
                          rows={3}
                          disabled={busyId !== null}
                          placeholder="For example: Make it warmer, focus on their renewal, and ask for a reply by email."
                          className="w-full rounded border border-cui-border px-2.5 py-1.5 text-sm focus:border-cui-primary focus:outline-none"
                        />
                        <p className="text-xs text-cui-muted">Uses the draft above, your sender profile and permitted contact context. Saves a revised draft for review; does not send. Up to 1,000 characters.</p>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => void rewriteDraft(item)}
                            disabled={busyId !== null || !(rewriteInstructions[item.id] ?? '').trim()}
                            className="rounded bg-cui-primary px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                            {isRewriting && busyId === item.id ? 'Rewriting...' : 'Generate rewrite'}
                          </button>
                          <button type="button" onClick={() => setRewriteId(null)} disabled={busyId !== null}
                            className="rounded border border-cui-border bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-60">Cancel</button>
                        </div>
                      </div>
                    ) : null}
                    <p className="text-xs font-semibold text-cui-muted">Why this message? Recorded facts cited by the draft (verify before sending):</p>
                    {item.cited_signals.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {item.cited_signals.map((signal, index) => (
                          <span key={index} className="rounded bg-cui-info/10 px-2 py-0.5 text-[11px] font-semibold text-cui-info">
                            {signal}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <p className="text-xs text-cui-muted">Review the contact profile, draft and citations before approving.</p>
                    {outreachQualityIssues(draft).length ? <ul className="list-inside list-disc rounded border border-cui-warning/40 bg-cui-warning/10 p-2 text-xs text-amber-900">
                      {outreachQualityIssues(draft).map((issue) => <li key={issue}>{issue}</li>)}
                    </ul> : <p className="text-xs text-green-700">Basic length, subject and wording checks passed. Factual review is still required.</p>}
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>

        {/* Active enrollments */}
        <Card>
          <CardHeader>
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-4 w-4 text-cui-primary" />
              Sequences in flight ({data?.enrollments.length ?? 0})
            </span>
          </CardHeader>
          <CardBody className="p-0">
            {(data?.enrollments.length ?? 0) === 0 ? (
              <p className="p-4 text-center text-sm text-cui-muted">
                No one is enrolled yet. Open a lead and use &ldquo;Start email sequence&rdquo; in the profile drawer.
              </p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-cui-border/60 bg-cui-light text-xs font-semibold uppercase tracking-wide text-cui-muted">
                    <th className="px-4 py-2">Lead</th>
                    <th className="px-4 py-2">Progress</th>
                    <th className="px-4 py-2">Next send</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.enrollments ?? []).map((enrollment) => (
                    <tr key={enrollment.id} className="border-b border-cui-light last:border-b-0">
                      <td className="px-4 py-2">
                        <Link href={`/leads?lead=${enrollment.lead_id}` as Route} className="font-semibold text-cui-primary hover:underline">
                          {enrollment.lead_name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-cui-text">
                        {enrollment.current_step} of {enrollment.total_steps} accepted
                      </td>
                      <td className="px-4 py-2 text-cui-muted">{prettyDateTime(enrollment.next_send_at)}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-semibold ${
                            enrollment.status === 'active' ? 'bg-cui-success/15 text-green-700' : 'bg-cui-warning/20 text-amber-700'
                          }`}
                        >
                          {enrollment.status}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          {enrollment.status === 'active' ? (
                            <button
                              type="button"
                              onClick={() => void actOnEnrollment(enrollment, 'pause')}
                              disabled={busyId === enrollment.id}
                              title="Pause"
                              className="rounded border border-cui-border p-1 text-cui-muted transition hover:text-cui-text disabled:opacity-60"
                            >
                              <Pause className="h-3.5 w-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void actOnEnrollment(enrollment, 'resume')}
                              disabled={busyId === enrollment.id}
                              title="Resume"
                              className="rounded border border-cui-border p-1 text-cui-muted transition hover:text-cui-success disabled:opacity-60"
                            >
                              <Play className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void actOnEnrollment(enrollment, 'cancel')}
                            disabled={busyId === enrollment.id}
                            title="Cancel sequence"
                            className="rounded border border-cui-border p-1 text-cui-muted transition hover:text-cui-danger disabled:opacity-60"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {/* Recent activity */}
        <Card>
          <CardHeader>Outreach delivery activity</CardHeader>
          <div className="space-y-2 border-b border-cui-border px-4 py-3">
            <label className="text-sm font-semibold text-cui-text">
              Activity status
              <select value={activityFilter} onChange={(event) => setActivityFilter(event.target.value)}
                className="ml-2 rounded border border-cui-border bg-white px-2 py-1">
                {activityFilters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <p className="text-xs text-cui-muted">Latest 25 matching attempts. Uncertain attempts cannot be resent here. Send slots include in-progress and uncertain attempts, not confirmed deliveries.</p>
          </div>
          <CardBody className="p-0">
            {(data?.recent.length ?? 0) === 0 ? (
              <p className="p-4 text-center text-sm text-cui-muted">No outreach attempts match this status.</p>
            ) : (
              <ul className="divide-y divide-cui-light">
                {(data?.recent ?? []).map((item) => (
                  <li key={item.id} id={`attempt-${item.id}`} className={`flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm ${item.id === attempt ? 'bg-cui-primary/10 ring-2 ring-inset ring-cui-primary/30' : ''}`}>
                    <div className="min-w-0">
                      <Link href={`/leads?lead=${item.lead_id}` as Route} className="font-semibold text-cui-primary hover:underline">
                        {item.lead_name}
                      </Link>
                      <span className="ml-2 text-cui-text">{item.subject}</span>
                      <p className="break-all text-xs text-cui-muted">Attempt ID: {item.id}</p>
                      {item.error ? <span className="ml-2 text-xs text-cui-danger">{item.error}</span> : null}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-cui-muted">
                      <DeliveryState status={item.status} busy={busyId === item.id} onFinish={() => void finishRecording(item)} />
                      <span>{prettyDateTime(item.sent_at ?? item.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {data?.agent_outreach_enabled ? <Card><CardHeader>My sequence permissions</CardHeader><CardBody><AgentOutreachSettings /></CardBody></Card> : null}
        <Link href="/settings?tab=outreach" className="text-sm font-semibold text-cui-primary underline">Outreach settings</Link>
      </div>
    </SectionLayout>
  );
}
