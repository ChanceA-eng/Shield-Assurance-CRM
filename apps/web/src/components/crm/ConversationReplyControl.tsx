'use client';

import { useEffect, useRef, useState } from 'react';
import type { RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import ConversationTool from './ConversationTool';

interface ReplyMessage {
  id: string; subject: string; sent_at: string; gmail_url?: string | null;
  metadata?: { attachments?: Array<{ name: string; imported: boolean }> };
}
interface Replies { enabled: boolean; rows?: ReplyMessage[]; next_offset?: number | null }

export default function ConversationReplyControl({ target, value, onChange, onDraft, disabled, hasDraft, onBusy }: {
  target: RecordTarget; value: string; onChange: (id: string, subject: string) => void;
  onDraft: (body: string) => void; disabled: boolean; hasDraft: boolean;
  onBusy: (busy: boolean) => void;
}): JSX.Element {
  const [data, setData] = useState<Replies | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const active = useRef(true), drafting = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; generation.current++; if (drafting.current) onBusy(false); };
  }, [onBusy]);
  const endpoint = `/api/gmail/threads?record_type=${target.type}&record_id=${encodeURIComponent(target.id)}`;
  const load = async (offset?: number): Promise<void> => {
    setBusy(true); setError('');
    try {
      const next = await workspaceFetch<Replies>(`${endpoint}${offset ? `&offset=${offset}` : ''}`);
      setData((previous) => offset ? { ...next, rows: [...(previous?.rows ?? []), ...(next.rows ?? [])] } : next);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Replies could not be loaded.'); }
    finally { setBusy(false); }
  };
  const selected = data?.rows?.find((row) => row.id === value);
  return <ConversationTool label="Reply" title="Reply to an email" selected={Boolean(value)} disabled={disabled}
    onOpen={() => { if (!data && !busy) void load(); }}>
    <div className="space-y-2">
      {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
      {!data && busy ? <p className="text-xs text-cui-muted">Loading emails...</p> : null}
      {data && !data.rows?.length ? <p className="text-xs text-cui-muted">No Gmail thread is available. You can still write a new email below.</p> : null}
      {data?.rows?.length ? <label className="block text-xs font-semibold">Email to reply to
        <select value={value} disabled={busy || disabled} onChange={(event) => {
          generation.current += 1;
          const message = data.rows?.find((row) => row.id === event.target.value);
          onChange(event.target.value, message ? (/^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject || 'Your message'}`) : '');
        }} className="mt-1 w-full rounded border border-cui-border p-2 text-sm">
          <option value="">New email</option>
          {data.rows.map((row) => <option key={row.id} value={row.id}>{row.subject || '(no subject)'} - {new Date(row.sent_at).toLocaleDateString()}</option>)}
        </select>
      </label> : null}
      {selected?.gmail_url ? <a className="text-xs text-cui-primary underline" href={selected.gmail_url} target="_blank" rel="noreferrer">Open in my Gmail</a> : null}
      {selected?.metadata?.attachments?.length ? <p className="text-xs text-cui-muted">Attachments: {selected.metadata.attachments.map((file) => file.name).join(', ')}</p> : null}
      {selected ? <button type="button" disabled={busy || disabled} className="rounded border border-cui-primary px-3 py-1.5 text-xs font-semibold text-cui-primary disabled:opacity-50" onClick={() => {
        if (hasDraft && !window.confirm('Replace your current message with an AI reply draft?')) return;
        const attempt = generation.current;
        drafting.current = true; onBusy(true); setBusy(true); setError('');
        void workspaceFetch<{ body: string }>(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reply_id: value }) })
          .then((draft) => { if (active.current && generation.current === attempt) onDraft(draft.body); })
          .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'The reply draft could not be generated.'))
          .finally(() => { if (active.current) { drafting.current = false; setBusy(false); onBusy(false); } });
      }}>{busy ? 'Drafting...' : 'Draft reply with AI'}</button> : null}
      <div className="flex gap-3">
        <button type="button" disabled={busy || disabled} onClick={() => void load()} className="text-xs text-cui-primary underline">Refresh emails</button>
        {data?.next_offset ? <button type="button" disabled={busy || disabled} onClick={() => void load(data.next_offset!)} className="text-xs text-cui-primary underline">Older emails</button> : null}
      </div>
    </div>
  </ConversationTool>;
}
