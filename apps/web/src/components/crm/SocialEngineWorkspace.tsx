'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import interactionPlugin from '@fullcalendar/interaction';
import type { SocialDraft, SocialEngineCommand, SocialEngineList, SocialIntent, SocialTestScenario } from '@crm/shared';
import { SOCIAL_TEST_SCENARIOS, SOCIAL_TIMEZONE } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { arizonaDateTimeInput, arizonaInputToIso, formatArizonaDateTime } from '../../lib/arizona-time';
import { Card, CardBody, CardHeader } from '../ui/Card';

const endpoint = '/api/social-marketing/engine';
const button = 'rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary disabled:opacity-50';
const labels: Record<SocialIntent['state'], string> = {
  awaiting_approval: 'Destination review', approved: 'Ready to schedule', scheduled: 'Scheduled',
  running: 'Publishing', retry_wait: 'Retry queued', confirming: 'Needs confirmation',
  simulated: 'Test completed', published: 'Published', failed: 'Failed', canceled: 'Canceled', blocked: 'Approval invalidated',
};
export default function SocialEngineWorkspace({ post, disabled = false, onBusyChange }: {
  post?: SocialDraft; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}): JSX.Element {
  const [data, setData] = useState<SocialEngineList | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState<SocialTestScenario>('success');
  const [connectionId, setConnectionId] = useState('');
  const [resolveRemoteId, setResolveRemoteId] = useState('');
  const [selected, setSelected] = useState<SocialIntent | null>(null);
  const [date, setDate] = useState('');
  const [calendar, setCalendar] = useState(false);
  const commandLock = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const next = await workspaceFetch<SocialEngineList>(endpoint);
      if (current !== generation.current) return;
      setData(next); setError('');
      setSelected((previous) => previous ? next.intents.find((intent) => intent.id === previous.id) ?? null : null);
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Could not load the publishing schedule.');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (!commandLock.current) void load(); }, 15000);
    return () => { clearInterval(timer); generation.current++; };
  }, [load]);
  async function command(value: SocialEngineCommand): Promise<void> {
    if (commandLock.current || disabled) return;
    commandLock.current = true; generation.current++;
    setBusy(true); onBusyChange?.(true); setNotice(''); setError('');
    try {
      await workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      setSelected(null);
      setNotice(value.action === 'prepare_publish'
        ? 'Live destination prepared. No provider request is made until an owner/admin approves and the schedule is due.'
        : value.action === 'resolve_publish'
          ? 'Provider outcome recorded.'
        : value.action === 'prepare' || value.action === 'approve' || value.action === 'schedule' || value.action === 'pause'
          ? 'Execution settings updated.' : 'Execution updated.');
      await load();
    } catch (failure) {
      await load();
      setError(failure instanceof Error ? failure.message : 'Could not update publishing execution.');
    } finally { commandLock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const locked = busy || disabled;
  const intents = data?.intents.filter((intent) => !post || intent.post_id === post.id) ?? [];
  const publishConnections = data?.connections?.filter((connection) => connection.state === 'connected' && connection.can_publish) ?? [];
  const liveWorkerActive = Boolean(data?.worker_real_enabled && data.worker_seen_at
    && Date.now() - Date.parse(data.worker_seen_at) < 45000 && !data.paused);
  return <Card className="!rounded-2xl !border-slate-200">
    <CardHeader className="flex-wrap !bg-white" actions={<button type="button" className={button} disabled={locked} onClick={() => void load()}>Refresh execution</button>}>{post ? 'Publishing destinations' : 'Publishing calendar & execution'}</CardHeader>
    <CardBody>
      <p className="mb-4 text-xs text-slate-500">Real provider publishing stays disabled unless the worker flag is explicitly enabled. Every live target requires current content approval, a separate owner/admin destination approval, and a due schedule. Test mode never contacts social networks. Dates use Arizona time.</p>
      {error ? <p role="alert" className="mb-4 text-sm text-red-800">{error}</p> : null}
      {notice ? <p role="status" className="mb-4 text-xs text-emerald-800">{notice}</p> : null}
      {!data && !error ? <p role="status">Loading execution...</p> : null}
      {data ? <>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${data.paused ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>{data.paused ? 'Publishing paused' : 'Dispatch allowed'}</span>
          <p className="mt-2 text-xs text-slate-500">{data.worker_seen_at && Date.now() - Date.parse(data.worker_seen_at) < 45000
            ? `${data.worker_test_enabled ? 'Test' : 'No test'} worker active${data.worker_real_enabled ? '; live Meta publishing enabled' : '; live Meta publishing disabled'}.`
            : 'Publishing worker is not responding. Refresh to check again, or contact support.'}</p></div>
          {data.can_manage ? <button type="button" className={button} disabled={locked} onClick={() => void command({ action: 'pause', paused: !data.paused })}>{data.paused ? 'Resume publishing engine' : 'Pause publishing engine'}</button> : null}
        </div>
        {post ? <div className="mb-5 flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold">Test scenario<select aria-label="Test scenario" value={scenario} disabled={locked} className="mt-2 block rounded-xl border border-slate-200 bg-white p-2" onChange={(event) => { const next = SOCIAL_TEST_SCENARIOS.find((item) => item === event.target.value); if (next) setScenario(next); }}>
            {SOCIAL_TEST_SCENARIOS.map((item) => <option key={item} value={item}>{item.replaceAll('_',' ')}</option>)}
          </select></label>
          <button type="button" className={button} disabled={locked || post.review_state !== 'approved'} onClick={() => void command({ action: 'prepare', id: crypto.randomUUID(), post_id: post.id, revision: post.revision, scenario })}>Prepare test destination</button>
          <label className="text-xs font-semibold">Live destination<select aria-label="Live destination" value={connectionId} disabled={locked || !publishConnections.length} className="mt-2 block min-w-56 rounded-xl border border-slate-200 bg-white p-2" onChange={(event) => setConnectionId(event.target.value)}>
            <option value="">Choose connected account</option>
            {publishConnections.map((connection) => <option key={connection.id} value={connection.id}>{connection.platform === 'facebook_page' ? 'Facebook' : 'Instagram'} - {connection.account_name}</option>)}
          </select></label>
          <button type="button" className={button} disabled={locked || post.review_state !== 'approved' || !connectionId}
            onClick={() => void command({ action: 'prepare_publish', id: crypto.randomUUID(), post_id: post.id, revision: post.revision, connection_id: connectionId })}>Prepare live target</button>
          {!publishConnections.length ? <span className="self-center text-xs text-slate-500">No connected account currently has publishing capability.</span> : null}
        </div> : <div className="mb-4 flex gap-2"><button type="button" className={button} aria-pressed={!calendar} onClick={() => setCalendar(false)}>Execution list</button><button type="button" className={button} aria-pressed={calendar} onClick={() => setCalendar(true)}>Month calendar</button></div>}
        {calendar ? <div className="mb-5 overflow-x-auto"><div className="min-w-[550px]"><FullCalendar plugins={[dayGridPlugin, interactionPlugin]} initialView="dayGridMonth" height="auto" timeZone="UTC"
          events={intents.filter((intent) => intent.scheduled_at).map((intent) => ({
            id: intent.id, allDay: true, start: arizonaDateTimeInput(intent.scheduled_at!).slice(0,10),
            title: `${intent.title} - ${labels[intent.state]} - ${formatArizonaDateTime(intent.scheduled_at)}`,
            backgroundColor: intent.state === 'simulated' ? '#4dbd74' : intent.state === 'failed' || intent.state === 'confirming' ? '#f86c6b' : '#20a8d8',
          }))}
          eventClick={(event) => { const intent = intents.find((item) => item.id === event.event.id); if (intent) { setSelected(intent); setDate(arizonaDateTimeInput(intent.scheduled_at ?? new Date())); } }} /></div></div> : null}
        {intents.map((intent) => <article key={intent.id} className="mb-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/60">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="mb-1 break-words text-sm font-semibold text-slate-900">{intent.title}</p><p className="text-sm font-semibold">{intent.destination === 'test' && intent.state === 'scheduled' ? 'Scheduled test' : intent.destination === 'test' && intent.state === 'running' ? 'Test running' : intent.destination === 'instagram_business' && intent.state === 'scheduled' && intent.container_status === 'processing' ? 'Instagram media processing' : labels[intent.state]} <span className="text-xs font-normal text-slate-500">- Revision {intent.revision} / {intent.destination === 'test' ? intent.scenario?.replaceAll('_',' ') ?? 'test' : data?.connections?.find((connection) => connection.id === intent.connection_id)?.account_name ?? intent.destination.replaceAll('_',' ')}</span></p>
            <p className="mt-1 text-xs text-slate-500">{formatArizonaDateTime(intent.scheduled_at)} AZ - Attempt {intent.attempt_count}/3</p></div>
            <span className="text-[10px] text-slate-500">{intent.destination === 'test' ? 'TEST ONLY' : 'REAL PROVIDER TARGET'}</span>
          </div>
          <p className="mt-2 text-xs text-slate-600">{intent.message}</p>
          {intent.receipt_id ? <p className="mt-1 break-all text-xs text-slate-500">Test receipt: {intent.receipt_id}</p> : null}
          {intent.remote_id ? <p className="mt-1 break-all text-xs text-slate-500">Provider ID: {intent.remote_id}{intent.permalink ? <> · <a className="font-semibold text-cui-primary underline" href={intent.permalink} target="_blank" rel="noreferrer">Open post</a></> : null}</p> : null}
          {intent.destination !== 'test' && intent.state === 'confirming' && data.can_manage ? <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold text-amber-900">Check the connected Meta account before resolving this result. The CRM will not retry an uncertain post automatically.</p>
            <label className="mt-3 block text-xs font-semibold text-amber-900">Meta post ID<input value={resolveRemoteId} onChange={(event) => setResolveRemoteId(event.target.value)}
              className="mt-1 block w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm" maxLength={70} /></label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={button} disabled={locked || !/^[0-9_]{1,70}$/.test(resolveRemoteId)}
                onClick={() => { void command({ action: 'resolve_publish', id: intent.id, expected_version: intent.version, resolution: 'published', remote_id: resolveRemoteId }); setResolveRemoteId(''); }}>Confirm published</button>
              <button type="button" className={button} disabled={locked} onClick={() => {
                if (window.confirm('Confirm you checked Meta and verified that this post was not published? Only then can a retry be enabled.')) {
                  void command({ action: 'resolve_publish', id: intent.id, expected_version: intent.version, resolution: 'not_published' });
                }
              }}>Confirm no post in Meta</button>
            </div>
          </div> : null}
          <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer">Execution history</summary>
            <p className="mt-2">Showing the latest 10 updates. Earlier history is preserved.</p>
            {intent.events.map((event) => <p key={event.version} className="mt-2">{formatArizonaDateTime(event.recorded_at)} - {labels[event.state]}: {event.message}</p>)}
            {intent.attempts.map((attempt) => <p key={attempt.attempt} className="mt-2">Attempt {attempt.attempt}: {attempt.outcome ?? 'In progress'} - {formatArizonaDateTime(attempt.started_at)}</p>)}
          </details>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.can_manage && intent.state === 'awaiting_approval' ? <button type="button" className={button} disabled={locked} onClick={() => void command({ action: 'approve', id: intent.id, expected_version: intent.version })}>{intent.destination === 'test' ? 'Approve test destination' : 'Approve live destination'}</button> : null}
            {data.can_manage && ['approved','scheduled','retry_wait'].includes(intent.state) ? <button type="button" className={button} disabled={locked} onClick={() => { setSelected(intent); setDate(arizonaDateTimeInput(intent.scheduled_at ?? new Date())); }}>{intent.destination === 'test' ? 'Schedule / reschedule test' : 'Schedule / reschedule post'}</button> : null}
            {data.can_manage && intent.destination !== 'test' && ['approved','scheduled','retry_wait'].includes(intent.state) ? <button type="button" className={button}
              disabled={locked || !liveWorkerActive} title={liveWorkerActive ? undefined : 'Enable the live worker and resume publishing before using Publish now.'}
              onClick={() => {
                if (window.confirm(`Publish "${intent.title}" to ${data.connections?.find((connection) => connection.id === intent.connection_id)?.account_name ?? intent.destination} now?`)) {
                  void command({ action: 'schedule', id: intent.id, expected_version: intent.version, scheduled_at: new Date(Date.now() + 5000).toISOString(), timezone: SOCIAL_TIMEZONE });
                }
              }}>Publish now</button> : null}
            {!['running','confirming','simulated','published','canceled'].includes(intent.state) ? <button type="button" className={button} disabled={locked} onClick={() => void command({ action: 'cancel', id: intent.id, expected_version: intent.version })}>{intent.destination === 'test' ? 'Cancel test' : 'Cancel post'}</button> : null}
            {data.can_manage && intent.state === 'failed' && intent.attempt_count < 3 && (intent.destination === 'test' || !intent.publish_dispatched_at) ? <button type="button" className={button} disabled={locked} onClick={() => void command({ action: 'retry', id: intent.id, expected_version: intent.version })}>{intent.destination === 'test' ? 'Retry test' : 'Retry post'}</button> : null}
            {data.can_manage && intent.state === 'confirming' && intent.destination === 'test' ? <button type="button" className={button} disabled={locked} onClick={() => void command({ action: 'confirm', id: intent.id, expected_version: intent.version })}>Confirm test outcome</button> : null}
          </div>
        </article>)}
        {!intents.length ? <p className="py-6 text-center text-sm text-slate-500">No publishing intents. Open approved content to select a test or live destination.</p> : null}
        {selected ? <section aria-label="Publishing schedule" className="mt-4 rounded-xl border border-cui-primary/30 bg-white p-4">
          <p className="mb-3 text-xs">Selected {selected.destination === 'test' ? 'test' : 'live post'}: revision {selected.revision}. Current state: {labels[selected.state]}.</p>
          <label className="block text-xs font-semibold">Arizona date & time<input type="datetime-local" value={date} disabled={locked} onChange={(event) => setDate(event.target.value)} className="mt-2 block max-w-full rounded-xl border border-slate-200 p-2" /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} disabled={locked || !data.can_manage || !['approved','scheduled','retry_wait'].includes(selected.state)} onClick={() => {
            const iso = arizonaInputToIso(date);
            if (!iso) { setError('Enter a valid Arizona date and time.'); return; }
            void command({ action: 'schedule', id: selected.id, expected_version: selected.version, scheduled_at: iso, timezone: SOCIAL_TIMEZONE });
          }}>{selected.destination === 'test' ? 'Confirm test schedule' : 'Confirm post schedule'}</button><button type="button" className={button} disabled={locked} onClick={() => setSelected(null)}>Close schedule</button></div>
        </section> : null}
      </> : null}
    </CardBody>
  </Card>;
}
