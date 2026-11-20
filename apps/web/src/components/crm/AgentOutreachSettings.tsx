'use client';
import { useCallback, useEffect, useState } from 'react';
import { OUTREACH_TEMPLATES, isOutreachTemplate, type OutreachTemplate } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
interface Enrollment { id: string; lead_id: string; template: OutreachTemplate; auto_send_enabled: boolean; leads: { full_name: string; email: string } }
export default function AgentOutreachSettings(): JSX.Element {
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [selected, setSelected] = useState('');
  const [purpose, setPurpose] = useState<OutreachTemplate>('auto');
  const [enabled, setEnabled] = useState(false);
  const [email, setEmail] = useState('');
  const [source, setSource] = useState('');
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setRows((await workspaceFetch<{ enrollments: Enrollment[] }>('/api/agency/outreach')).enrollments); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Agent sequences could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const save = async (value: object): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try { await workspaceFetch('/api/agency/outreach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); await load(); setNotice('Outreach settings saved.'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Authorization could not be saved.'); }
    finally { setBusy(false); }
  };
  const input = 'crm-input mt-1';
  return <section className="space-y-3 border-t border-cui-border pt-4"><h3 className="text-sm font-bold">My sequence sending permissions</h3>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-green-700">{notice}</p> : null}
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save({ enrollment_id: selected, template: purpose, enabled }); }}>
      <label className="text-xs font-semibold">My sequence<select required className={input} value={selected} onChange={(event) => {
        setSelected(event.target.value); const row = rows.find((item) => item.id === event.target.value);
        if (row) { setPurpose(row.template); setEnabled(row.auto_send_enabled); setEmail(row.leads?.email ?? ''); }
      }}><option value="">Select a sequence</option>{rows.map((row) => <option value={row.id} key={row.id}>{row.leads?.full_name ?? row.lead_id} · {row.auto_send_enabled ? 'Auto-send' : 'Review required'}</option>)}</select></label>
      <label className="text-xs font-semibold">Approved sequence purpose<select className={input} value={purpose} onChange={(event) => { if (isOutreachTemplate(event.target.value)) setPurpose(event.target.value); }}>{Object.entries(OUTREACH_TEMPLATES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />I authorize automatic sending of future drafts for this sequence and selected purpose from my mailbox.</label>
      <div><button disabled={busy || !selected} className="rounded border border-cui-primary px-3 py-1.5 text-sm text-cui-primary disabled:opacity-60">Save sequence permission</button></div>
    </form>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save({ action: 'record_consent', email, source, granted }); }}>
      <label className="text-xs font-semibold">Recipient marketing email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className={input} /></label>
      <label className="text-xs font-semibold">Consent source / evidence<input required maxLength={1000} value={source} onChange={(event) => setSource(event.target.value)} className={input} /></label>
      <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={granted} onChange={(event) => setGranted(event.target.checked)} />Marketing consent was explicitly granted. Leave unchecked to record revocation. This never removes an unsubscribe.</label>
      <div><button disabled={busy} className="rounded border border-cui-border px-3 py-1.5 text-sm disabled:opacity-60">Record consent state</button></div>
    </form>
  </section>;
}
