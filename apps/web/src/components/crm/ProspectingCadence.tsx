'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatAgencyDateTime } from '../../lib/agency-time';
import { workspaceFetch } from '../../lib/workspace-fetch';
import type { prospectingReadiness } from '../../lib/prospecting-evidence';

interface CadenceTouch {
  id: string;
  touch_number: number;
  channel: 'call' | 'email';
  due_at: string;
  status: string;
  outcome: string | null;
  voicemail: boolean;
  email_status: string | null;
  email_error: string | null;
}

interface Cadence {
  id: string;
  status: string;
  ended_reason: string | null;
  voicemail_count: number;
  agent_user_id: string;
  context?: { priority?: string; hook?: string; offer?: string };
  touches: CadenceTouch[];
}

interface CadenceResponse {
  cadence: Cadence | null;
  can_manage: boolean;
  can_cancel: boolean;
  readiness?: ReturnType<typeof prospectingReadiness>;
}

const OUTCOMES = [
  ['connected', 'Connected'],
  ['no_answer', 'No answer'],
  ['voicemail', 'Left voicemail'],
  ['not_interested', 'Not interested'],
] as const;

export default function ProspectingCadence({
  leadId,
  eligible,
  blocked,
  onChanged,
}: {
  leadId: string;
  eligible: boolean;
  blocked: boolean;
  onChanged?: () => void;
}): JSX.Element {
  const [cadence, setCadence] = useState<Cadence | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [canCancel, setCanCancel] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [summary, setSummary] = useState<ReturnType<typeof prospectingReadiness> | null>(null);
  const [priority, setPriority] = useState('C');

  const load = useCallback(async (): Promise<void> => {
    const result = await workspaceFetch<CadenceResponse>(
      `/api/leads/${encodeURIComponent(leadId)}/prospecting-cadence`,
    );
    setCadence(result.cadence);
    setCanManage(result.can_manage);
    setCanCancel(result.can_cancel);
    if (result.readiness) {
      setSummary(result.readiness);
      setPriority(result.cadence?.context?.priority ?? result.readiness.suggested_priority);
    }
  }, [leadId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void load().catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Prospecting plan could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, blocked, eligible]);

  const update = async (method: 'POST' | 'PATCH', payload: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await workspaceFetch<CadenceResponse | { cadence: Cadence | null; message?: string }>(
        `/api/leads/${encodeURIComponent(leadId)}/prospecting-cadence`,
        { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
      );
      setCadence(result.cadence);
      if ('can_manage' in result) {
        setCanManage(result.can_manage);
        setCanCancel(result.can_cancel);
      }
      setNotice('message' in result && result.message ? result.message : method === 'POST'
        ? 'The plan is active. Calls are tasks; emails wait for your approval.' : 'Plan updated.');
      onChanged?.();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The prospecting plan could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const start = (): void => { void update('POST', { confirm: true, priority }); };
  const cancel = (): void => { void update('PATCH', { action: 'cancel' }); };
  const logCall = (touchId: string): void => {
    const outcome = outcomes[touchId];
    if (outcome) void update('PATCH', { action: 'log_call', touch_id: touchId, outcome });
  };

  const mayStart = eligible && !blocked && cadence?.status !== 'active' && cadence?.status !== 'replied';
  const now = Date.now();
  return (
    <section className="rounded border border-cui-border bg-white">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-cui-border px-3 py-2">
        <div>
          <h3 className="text-sm font-semibold text-cui-dark">21-day prospecting plan</h3>
          <p className="mt-0.5 text-xs text-cui-muted">Four call tasks and four email drafts. Nothing sends automatically.</p>
        </div>
        {cadence?.status === 'active' && canCancel ? (
          <button type="button" disabled={busy} onClick={cancel} className="text-xs font-semibold text-cui-danger hover:underline disabled:opacity-50">
            Cancel plan
          </button>
        ) : null}
      </div>
      <div className="space-y-3 p-3">
        {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
        {notice ? <p role="status" className="text-xs text-cui-success">{notice}</p> : null}
        {summary ? <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold capitalize">{summary.data_level} prospect details</p>
            <label className="flex items-center gap-2">Priority
              <select aria-label="Prospecting priority" value={priority} disabled={busy || cadence?.status === 'active'}
                onChange={(event) => setPriority(event.target.value)} className="rounded border border-cui-border bg-white px-2 py-1">
                {['A', 'B', 'C'].map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <p className="text-cui-muted">Suggested {summary.suggested_priority}: {summary.priority_reason}</p>
          {summary.signals.map((signal) => <p key={`${signal.source}:${signal.recordId}:${signal.text}`}>
            {signal.text}<span className="block text-cui-muted">{signal.source} · {signal.observedOn} · refreshed {signal.fetchedAt.slice(0, 10)}</span>
          </p>)}
          <p className="text-cui-muted">{summary.identity}</p>
          {summary.confirmed_renewal ? <p>Confirmed {summary.confirmed_renewal.type} renewal: {summary.confirmed_renewal.date}</p> : null}
          {summary.nurture_on && !blocked ? <button type="button" disabled={busy}
            onClick={() => void update('PATCH', { action: 'nurture_reminder' })}
            className="font-semibold text-cui-primary hover:underline disabled:opacity-50">
            Add renewal-preparation reminder for {summary.nurture_on}
          </button> : null}
        </div> : null}
        {loading ? <p className="text-xs text-cui-muted">Loading plan…</p> : null}
        {!loading && cadence ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="font-semibold capitalize text-cui-dark">Plan {cadence.status.replaceAll('_', ' ')}</p>
              <p className="text-cui-muted">Voicemails: {cadence.voicemail_count}/2</p>
            </div>
            {cadence.ended_reason && cadence.status !== 'active' ? <p className="text-xs text-cui-muted">{cadence.ended_reason}</p> : null}
            {cadence.context?.hook ? <p className="text-xs"><strong>Selected angle:</strong> {cadence.context.hook}<br /><strong>Offer:</strong> {cadence.context.offer}</p> : null}
            <p className="text-xs text-cui-muted">{cadence.touches.filter((touch) => touch.status === 'completed').length}/8 touches resolved · {cadence.touches.filter((touch) => touch.outcome === 'email_sent').length} emails accepted by provider · {cadence.touches.filter((touch) => touch.outcome === 'connected').length} calls connected</p>
            <ol className="space-y-1.5">
              {cadence.touches.map((touch) => {
                const isDue = Date.parse(touch.due_at) <= now;
                return (
                  <li key={touch.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-cui-light/70 px-2.5 py-2 text-xs">
                    <div className="min-w-[170px]">
                      <p className="font-semibold text-cui-dark">Touch {touch.touch_number}: {touch.channel === 'call' ? 'Call' : 'Email'}</p>
                      <p className="text-cui-muted">{formatAgencyDateTime(touch.due_at)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-cui-muted">
                        {touch.channel === 'email' && touch.email_status === 'pending_approval'
                          ? 'Draft ready for review'
                          : touch.email_status?.replaceAll('_', ' ') ?? touch.outcome?.replaceAll('_', ' ') ?? touch.status.replaceAll('_', ' ')}
                      </span>
                      {touch.channel === 'email' && touch.email_status === 'pending_approval' ? (
                        <Link href="/outreach" className="font-semibold text-cui-primary hover:underline">Review draft</Link>
                      ) : null}
                      {touch.channel === 'call' && touch.status === 'planned' && isDue && canManage && cadence.status === 'active' ? (
                        <>
                          <select
                            aria-label={`Outcome for call touch ${touch.touch_number}`}
                            value={outcomes[touch.id] ?? ''}
                            onChange={(event) => setOutcomes((current) => ({ ...current, [touch.id]: event.target.value }))}
                            className="rounded border border-cui-border bg-white px-2 py-1"
                          >
                            <option value="">Log outcome</option>
                            {OUTCOMES.map(([value, label]) => (
                              <option key={value} value={value} disabled={value === 'voicemail' && cadence.voicemail_count >= 2}>{label}</option>
                            ))}
                          </select>
                          <button type="button" disabled={busy || !outcomes[touch.id]} onClick={() => logCall(touch.id)}
                            className="rounded bg-cui-primary px-2 py-1 font-semibold text-white disabled:opacity-50">Save</button>
                        </>
                      ) : null}
                    </div>
                    {touch.email_error ? <p role="alert" className="w-full text-cui-danger">{touch.email_error}</p> : null}
                  </li>
                );
              })}
            </ol>
            {cadence.status === 'active' && canManage ? <button type="button" disabled={busy || blocked}
              onClick={() => void update('PATCH', { action: 'prepare_drafts' })}
              className="text-xs font-semibold text-cui-primary hover:underline disabled:opacity-50">
              Prepare due email drafts
            </button> : null}
          </>
        ) : null}
        {!loading && !cadence ? <p className="text-xs text-cui-muted">Start only when you are ready to follow up personally for the next three weeks.</p> : null}
        {!loading && mayStart ? (
          <button type="button" disabled={busy} onClick={start}
            className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            {cadence ? 'Start a new 21-day plan' : 'Start 21-day plan'}
          </button>
        ) : null}
        {!loading && !eligible ? <p className="text-xs text-cui-muted">Plans are available for leads in active prospecting.</p> : null}
        {!loading && blocked ? <p className="text-xs text-cui-danger">Clear the contact restriction before starting outreach.</p> : null}
      </div>
    </section>
  );
}
