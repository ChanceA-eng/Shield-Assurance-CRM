'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { SALES_CATEGORIES, salesFields, renderSalesTemplate, emailDesignErrors, type EmailDesign, type SalesFacts, type SalesTemplate, type SalesTemplateSnapshot } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import ConversationTool from './ConversationTool';
import EmailDesignPreview from './EmailDesignPreview';
import EmailDesignEditor from './EmailDesignEditor';

export type SelectedSalesTemplate = SalesTemplateSnapshot;
export default function SalesTemplatePicker({ conversation, channel = 'email', disabled, hasDraft, onApply, onBusy, appliedTemplate, onRemove, children }: {
  conversation: string; channel?: 'email' | 'sms'; disabled: boolean; hasDraft: boolean;
  onApply: (draft: { subject: string; body: string; template: SelectedSalesTemplate }) => void;
  onBusy: (busy: boolean) => void;
  appliedTemplate: SelectedSalesTemplate | null;
  onRemove: () => void;
  children?: ReactNode;
}): JSX.Element {
  const [rows, setRows] = useState<SalesTemplate[]>([]), [selected, setSelected] = useState('');
  const [facts, setFacts] = useState<SalesFacts>({}), [search, setSearch] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [recommended, setRecommended] = useState<string[]>([]);
  const [appointments, setAppointments] = useState<Array<{ id: string; details: string }>>([]), [appointmentId, setAppointmentId] = useState('');
  const [canManage, setCanManage] = useState(false);
  const [design, setDesign] = useState<EmailDesign | undefined>();
  const [designNotice, setDesignNotice] = useState('');
  useEffect(() => {
    let active = true;
    setSelected(''); setFacts({}); setError(''); setConfirmed(false);
    void workspaceFetch<{ templates: SalesTemplate[]; facts: SalesFacts; recommended: string[]; canManage?: boolean }>(`/api/sales-templates?conversation=${encodeURIComponent(conversation)}`)
      .then((data) => { if (active) { setRows(data.templates); setFacts(data.facts); setRecommended(data.recommended); setCanManage(data.canManage === true); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Templates could not be loaded.'); });
    return () => { active = false; };
  }, [conversation]);
  const template = rows.find((row) => row.id === selected);
  useEffect(() => {
    setDesign(template?.email_design);
  }, [template]);
  const designDirty = Boolean(template && JSON.stringify(design) !== JSON.stringify(template.email_design));
  const chooseTemplate = (id: string): void => {
    if (designDirty && !window.confirm('Discard unsaved template design changes?')) return;
    setSelected(id); setConfirmed(false); setDesignNotice(''); setError('');
  };
  const saveDesign = async (): Promise<void> => {
    if (!template || !canManage) return;
    const errors = emailDesignErrors(design);
    if (errors.length) { setError(errors.join(' ')); return; }
    setBusy(true); onBusy(true); setError(''); setDesignNotice('');
    try {
      const saved = await workspaceFetch<SalesTemplate>('/api/sales-templates', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...template, email_design: design ?? null }),
      });
      setRows((current) => current.map((row) => row.id === saved.id ? saved : row));
      setConfirmed(false);
      setDesignNotice('Design saved. Verify the details, then use the template.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Design could not be saved. Your edits are unchanged.');
    } finally { setBusy(false); onBusy(false); }
  };
  const preview = template ? renderSalesTemplate(template, channel, facts) : null;
  const needsAppointment = template ? salesFields(template, channel).includes('appointment_details') : false;
  useEffect(() => {
    if (!needsAppointment) return;
    let active = true;
    setAppointments([]); setAppointmentId('');
    setFacts((current) => ({ ...current, appointment_details: '' }));
    void workspaceFetch<{ appointments: Array<{ id: string; details: string }> }>(`/api/appointments?conversation=${encodeURIComponent(conversation)}`)
      .then((data) => { if (active) setAppointments(data.appointments); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Appointments could not be loaded.'); });
    return () => { active = false; };
  }, [needsAppointment, conversation]);
  const apply = async (personalize: boolean): Promise<void> => {
    if (!template || !confirmed || preview?.missing.length || designDirty) return;
    if (hasDraft && !window.confirm('Replace your current draft with this template?')) return;
    setBusy(true); onBusy(true); setError('');
    try {
      const draft = await workspaceFetch<{ subject: string; body: string; template: SelectedSalesTemplate }>('/api/sales-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: template.id, revision: template.revision, channel, conversation, facts, personalize, confirmed,
          ...(needsAppointment ? { appointment_id: appointmentId } : {}) }),
      });
      onApply(draft); setSelected('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Template could not be applied. Your draft is unchanged.'); }
    finally { setBusy(false); onBusy(false); }
  };
  return <ConversationTool label="Templates" title="Sales templates" large selected={Boolean(appliedTemplate)} disabled={disabled}>
    {children}
    {appliedTemplate ? <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="text-cui-muted">{rows.find((row) => row.id === appliedTemplate.id)?.name ?? 'Template applied'}</span>
      <button type="button" disabled={busy || disabled} className="font-semibold text-cui-primary underline disabled:opacity-50"
        onClick={() => {
          if (!window.confirm('Remove this template and clear the message subject and body, including your edits?')) return;
          onRemove(); setSelected(''); setConfirmed(false); setError(''); setSearch('');
        }}>Remove template</button>
    </div> : null}
    <fieldset disabled={busy || disabled} className="space-y-2">
      {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
      {recommended.length ? <div className="flex flex-wrap gap-2 text-xs"><span>Suggested from conversation:</span>
        {rows.filter((row) => recommended.includes(row.id)).map((row) => <button key={row.id} type="button" className="text-cui-primary underline"
          onClick={() => chooseTemplate(row.id)}>{row.name}</button>)}</div> : null}
      <input aria-label="Search sales templates" placeholder="Search all sales templates" value={search}
        onChange={(event) => setSearch(event.target.value)} className="w-full rounded border border-cui-border p-2 text-sm" />
      <select aria-label="Choose sales template" value={selected} onChange={(event) => chooseTemplate(event.target.value)}
        className="w-full rounded border border-cui-border p-2 text-sm">
        <option value="">All sales templates</option>
        {SALES_CATEGORIES.map((category) => <optgroup key={category} label={category}>
          {rows.filter((row) => row.category === category && row.name.toLowerCase().includes(search.toLowerCase()))
            .map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </optgroup>)}
      </select>
      {template ? <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
        <button type="button" className="text-xs text-cui-primary underline" onClick={() => chooseTemplate('')}>Clear selection</button>
        {needsAppointment ? <label className="block text-xs font-semibold">Scheduled appointment
          <select aria-label="Scheduled appointment" className="mt-1 w-full rounded border border-cui-border p-2 text-sm" value={appointmentId}
            onChange={(event) => { setAppointmentId(event.target.value); setConfirmed(false);
              setFacts((current) => ({ ...current, appointment_details: appointments.find((row) => row.id === event.target.value)?.details ?? '' })); }}>
            <option value="">Choose a saved appointment</option>{appointments.map((row) => <option key={row.id} value={row.id}>{row.details}</option>)}
          </select>
          {!appointments.length ? <p className="mt-1 font-normal text-cui-muted">No scheduled appointments. Book one from the conversation first.</p> : null}
        </label> : null}
        {salesFields(template, channel).filter((field) => field !== 'agent_name' && field !== 'agency_name' && field !== 'appointment_details').map((field) =>
          <label key={field} className="block text-xs font-semibold">{field.replace(/_/g, ' ')}
            <input maxLength={2000} value={facts[field] ?? ''} onChange={(event) => { setFacts({ ...facts, [field]: event.target.value }); setConfirmed(false); }}
              className="mt-1 w-full rounded border border-cui-border p-2 text-sm" /></label>)}
        {channel === 'email' && canManage ? <>
          <EmailDesignEditor value={design} brandName={facts.agency_name} heading={preview && !preview.missing.length ? preview.subject : ''}
            onChange={(value) => { setDesign(value); setConfirmed(false); setDesignNotice(''); setError(''); }} />
          {designDirty ? <div className="space-y-1">
            <button type="button" onClick={() => void saveDesign()} className="rounded border border-cui-primary px-3 py-2 text-xs font-semibold text-cui-primary">
              Save template design
            </button>
            <p className="text-xs text-cui-muted">Updates this shared template. Previously approved messages may need review.</p>
          </div> : null}
          {designNotice ? <p role="status" className="text-xs text-green-800">{designNotice}</p> : null}
        </> : null}
        <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          {template.id.startsWith('cold_first_touch')
            ? 'I verified the business detail and offer, and this prospect is appropriate to contact.'
            : 'I verified the details and that this sales event actually occurred where the template says it did.'}</label>
        {preview?.missing.length ? <p className="text-xs text-cui-danger">Complete: {preview.missing.join(', ')}</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!confirmed || Boolean(preview?.missing.length) || designDirty} onClick={() => void apply(false)}
            className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Use template</button>
          <button type="button" disabled={!confirmed || Boolean(preview?.missing.length) || designDirty || conversation.startsWith('unmatched:')} onClick={() => void apply(true)}
            className="rounded border border-cui-primary px-3 py-2 text-xs text-cui-primary disabled:opacity-50">Personalize with AI</button>
        </div>
        </div>
        <div className="min-w-0 rounded bg-cui-light p-2 text-xs lg:sticky lg:top-0"><p className="font-semibold">{preview?.subject}</p>
          {channel === 'email' ? <EmailDesignPreview body={preview?.body ?? ''} design={design} />
            : <p className="whitespace-pre-wrap">{preview?.body}</p>}</div>
      </div> : null}
      {channel === 'sms' ? <p className="text-xs text-cui-muted">SMS drafts only. Sending and scheduling require a connected outbound provider.</p> : null}
    </fieldset>
  </ConversationTool>;
}
