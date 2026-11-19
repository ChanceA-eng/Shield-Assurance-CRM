'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useAgencyTimeZone } from '../../hooks/useAgencyTimeZone';
import { agencyDateTimeInput, agencyInputToIso, formatAgencyDateTime } from '../../lib/agency-time';
import { workspaceFetch } from '../../lib/workspace-fetch';
import type { SelectedSalesTemplate } from './SalesTemplatePicker';
import ConversationTool from './ConversationTool';
import type { EmailDocument } from '@crm/shared';

interface ScheduledEmail { id: string; send_at: string; subject: string; status: string; last_error: string | null }

export default function ScheduleSend({ conversationKey, subject, body, bodyDocument, disabled, onScheduled, onBusy, channel = 'email', template, emailProvider = 'default', replySelected = false, onEdit, children }: {
  conversationKey: string; subject: string; body: string; disabled: boolean; channel?: 'email' | 'sms';
  onScheduled: () => void; onBusy: (busy: boolean) => void;
  template?: SelectedSalesTemplate | null;
  emailProvider?: 'default' | 'gmail';
  replySelected?: boolean;
  onEdit?: (id: string) => void; children?: ReactNode;
  bodyDocument?: EmailDocument;
}): JSX.Element {
  const agency = useAgencyTimeZone();
  const [sendAt, setSendAt] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [rows, setRows] = useState<ScheduledEmail[]>([]);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const endpoint = conversationKey.startsWith('lead:')
    ? `/api/leads/${encodeURIComponent(conversationKey.slice(5))}/scheduled-messages`
    : `/api/communication/scheduled?conversation=${encodeURIComponent(conversationKey)}`;
  const load = useCallback(async () => { setRows(await workspaceFetch<ScheduledEmail[]>(endpoint)); }, [endpoint]);
  useEffect(() => {
    setRows([]); setError(''); setNotice(''); setSendAt(''); request.current = null;
    if (channel === 'sms') return;
    void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Scheduled emails could not be loaded.'));
  }, [load, channel]);
  const schedule = async (): Promise<void> => {
    const iso = agency.timeZone ? agencyInputToIso(sendAt, agency.timeZone) : null;
    if (!iso) { setError('Choose a valid future send time.'); return; }
    const input = { subject, body, send_at: iso, channel, sales_template: template,
      ...(bodyDocument ? { body_document: bodyDocument } : {}),
      ...(emailProvider === 'gmail' ? { email_provider: 'gmail' } : {}) };
    const payload = JSON.stringify(input);
    if (Date.parse(iso) <= Date.now() && request.current?.payload !== payload) {
      setError('Choose a valid future send time.'); return;
    }
    if (request.current?.payload !== payload) request.current = { payload, id: crypto.randomUUID() };
    setBusy(true); onBusy(true); setError(''); setNotice('');
    try {
      const saved = await workspaceFetch<{ status: string }>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, request_id: request.current.id }) });
      if (saved.status === 'failed' || saved.status === 'cancelled') {
        setError(`This scheduled email is ${saved.status}. Review its status before scheduling another email.`);
        await load(); return;
      }
      request.current = null; setSendAt('');
      setNotice(saved.status === 'sent' ? 'This email was already sent. No duplicate was queued.'
        : saved.status === 'processing' ? 'This email is already being processed. No duplicate was queued.'
        : `Email queued for ${formatAgencyDateTime(iso, agency.timeZone ?? undefined)}. Not sent yet.`);
      onScheduled();
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Scheduling failed. Your draft is retained.');
    } finally { setBusy(false); onBusy(false); }
  };
  return <ConversationTool label="Schedule send" title="Schedule send" action selected={rows.some((row) => row.status === 'pending')}>{(close) =>
    <div className="space-y-2">
    {replySelected ? <p className="text-xs text-cui-muted">Clear the reply selection to schedule a new email.</p> : null}
    {channel === 'sms' ? <p className="text-xs text-cui-muted">Text sending and scheduling are unavailable until an SMS provider is connected.</p> : null}
    {error || agency.error ? <p role="alert" className="text-xs text-cui-danger">{error || agency.error}</p> : null}
    {notice ? <p role="status" className="text-xs text-cui-success">{notice}</p> : null}
    {channel === 'email' ? <div className="space-y-2">
      <label className="block text-xs font-semibold">Send date and time - {agency.timeZone ?? 'loading'}
        <input type="datetime-local" value={sendAt} disabled={busy || !agency.timeZone}
          min={agency.timeZone ? agencyDateTimeInput(new Date(), agency.timeZone) : undefined}
          onChange={(event) => setSendAt(event.target.value)} className="mt-1 block max-w-full rounded border border-cui-border px-2 py-1.5 text-sm" />
      </label>
      <p className="text-xs text-cui-muted">Sends on the next delivery run after this time, not an exact-time guarantee.</p>
      <button type="button" disabled={busy || disabled || replySelected || !agency.timeZone || !sendAt || !body.trim()}
        onClick={() => void schedule()} className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
        {busy ? 'Scheduling…' : 'Confirm schedule'}
      </button>
    </div> : null}
    {rows.filter((row) => row.status !== 'sent' && row.status !== 'cancelled').map((row) => <div key={row.id} className="rounded border border-cui-border p-2 text-xs">
      <p className="break-words font-semibold">{row.subject} · {row.status}</p>
      <p>{agency.timeZone ? formatAgencyDateTime(row.send_at, agency.timeZone) : row.send_at}</p>
      {row.last_error ? <p className="text-cui-danger">{row.last_error}</p> : null}
      {row.status === 'pending' && onEdit ? <button type="button" disabled={busy} className="mr-3 mt-1 text-cui-primary underline" onClick={() => { close(); onEdit(row.id); }}>Edit scheduled email</button> : null}
      {row.status === 'pending' ? <button type="button" disabled={busy} className="mt-1 text-cui-primary underline" onClick={() => {
        setBusy(true); onBusy(true); setError('');
        void workspaceFetch(endpoint, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id }) })
          .then(load).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Cancellation failed.'))
          .finally(() => { setBusy(false); onBusy(false); });
      }}>Cancel scheduled email</button> : null}
    </div>)}
    {children}
  </div>}</ConversationTool>;
}
