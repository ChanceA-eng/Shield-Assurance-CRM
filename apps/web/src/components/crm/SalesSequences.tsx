'use client';
import { useCallback, useEffect, useState } from 'react';
import { SALES_SEQUENCE_PRESETS, SALES_FIELDS, renderSalesTemplate, salesFields, type SalesFacts, type SalesTemplate, type SalesSequencePlan } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import EmailProviderControl, { type EmailProviderChoice } from './EmailProviderControl';
import ConversationTool from './ConversationTool';
import EmailDesignPreview from './EmailDesignPreview';

interface SequenceList {
  actor: string;
  rows: Array<{ id: string; status: string; sales_plan: SalesSequencePlan; current_step: number; total_steps: number; ended_reason: string | null }>;
  appointments: Array<{ id: string; subject: string; event_date: string }>;
  quotes: Array<{ id: string; carrier: string; line_of_business: string }>;
}
export default function SalesSequences({ leadId, embedded = false }: { leadId: string; embedded?: boolean }): JSX.Element {
  const [data, setData] = useState<SequenceList | null>(null), [templates, setTemplates] = useState<SalesTemplate[]>([]);
  const [facts, setFacts] = useState<SalesFacts>({});
  const [preset, setPreset] = useState<keyof typeof SALES_SEQUENCE_PRESETS>('initial_contact');
  const [evidence, setEvidence] = useState(''), [gap, setGap] = useState(5), [confirmed, setConfirmed] = useState(false);
  const [emailProvider, setEmailProvider] = useState<EmailProviderChoice>('gmail'), [approveAll, setApproveAll] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [sequences, library] = await Promise.all([
      workspaceFetch<SequenceList>(`/api/sales-sequences?lead=${leadId}`),
      workspaceFetch<{ templates: SalesTemplate[]; facts: SalesFacts }>(`/api/sales-templates?conversation=${encodeURIComponent(`lead:${leadId}`)}`),
    ]);
    setData(sequences); setTemplates(library.templates); setFacts(library.facts);
  }, [leadId]);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Sales sequences could not be loaded.')); }, [load]);
  const definition = SALES_SEQUENCE_PRESETS[preset];
  const steps = definition.templates.map((id) => templates.find((row) => row.id === id));
  const needed = SALES_FIELDS.filter((field) => field !== 'agent_name' && field !== 'agency_name' && steps.some((template) => template && salesFields(template, 'email').includes(field)));
  const save = async (id?: string, action?: string): Promise<void> => {
    if (action === 'enable_auto' && !window.confirm('Enable automatic sending for eligible follow-up steps in this enrollment? The first and event-dependent steps still require approval. Existing consent and reply protections apply.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await workspaceFetch<{ message?: string }>('/api/sales-sequences', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id, action, confirmed: action === 'enable_auto' } : {
          lead_id: leadId, preset, evidence_id: evidence, gap, facts, confirmed,
          ...(emailProvider === 'gmail' ? { email_provider: 'gmail' } : {}),
          auto_send: approveAll,
        }),
      });
      await load(); setNotice(saved.message ?? 'Sequence state saved.'); setConfirmed(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Sequence change was not confirmed. Refresh before retrying enrollment.'); }
    finally { setBusy(false); }
  };
  const content = <div className="space-y-3">
      {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-xs text-green-800">{notice}</p> : null}
      <button type="button" disabled={busy} className="text-xs text-cui-primary underline" onClick={() => void load().catch((failure: unknown) => setError(String(failure)))}>Refresh sequences</button>
      {data?.rows.map((row) => <div key={row.id} className="space-y-2 rounded bg-cui-light p-2 text-xs">
        <p className="font-semibold">{SALES_SEQUENCE_PRESETS[row.sales_plan.preset]?.name} - {row.status} - {row.current_step}/{row.total_steps}</p>
        <p>Auto-send: {row.sales_plan.auto_send ? 'enabled for eligible follow-ups' : 'off (approval first)'}</p>
        {row.ended_reason ? <p>{row.ended_reason}</p> : null}
        {row.sales_plan.actor === data.actor && ['active', 'paused'].includes(row.status) ? <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} className="text-cui-primary underline"
            onClick={() => void save(row.id, row.status === 'paused' ? 'resume' : 'pause')}>{row.status === 'paused' ? 'Resume (auto-send off)' : 'Pause'}</button>
          <button type="button" disabled={busy || row.status !== 'active'} className="text-cui-primary underline"
            onClick={() => void save(row.id, row.sales_plan.auto_send ? 'disable_auto' : 'enable_auto')}>{row.sales_plan.auto_send ? 'Disable auto-send' : 'Enable auto-send for this enrollment'}</button>
          <button type="button" disabled={busy} className="text-cui-danger underline" onClick={() => void save(row.id, 'cancel')}>Cancel sequence</button>
        </div> : null}
      </div>)}
      <fieldset disabled={busy || !data || data.rows.some((row) => ['active', 'paused'].includes(row.status))} className="space-y-2">
        <EmailProviderControl value={emailProvider} onChange={(provider) => { setEmailProvider(provider); setApproveAll(false); setConfirmed(false); }} disabled={busy} />
        <label className="block text-xs font-semibold">Sequence<select className="mt-1 w-full rounded border border-cui-border p-2 text-sm" value={preset}
          onChange={(event) => {
            const key = Object.keys(SALES_SEQUENCE_PRESETS).find((key) => key === event.target.value) as keyof typeof SALES_SEQUENCE_PRESETS | undefined;
            if (key) { setPreset(key); setEvidence(''); setConfirmed(false); }
          }}>{Object.entries(SALES_SEQUENCE_PRESETS).map(([id, value]) => <option key={id} value={id}>{value.name}</option>)}</select></label>
        {definition.requires ? <label className="block text-xs font-semibold">Verified CRM {definition.requires}
          <select className="mt-1 w-full rounded border border-cui-border p-2 text-sm" value={evidence} onChange={(event) => { setEvidence(event.target.value); setConfirmed(false); }}>
            <option value="">Choose a recorded {definition.requires}</option>
            {definition.requires === 'appointment' ? data?.appointments.map((event) => <option key={event.id} value={event.id}>{event.subject} - {event.event_date}</option>)
              : data?.quotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.carrier} - {quote.line_of_business}</option>)}
          </select></label> : null}
        <label className="block text-xs font-semibold">Days between steps<input type="number" min={1} max={30} value={gap}
          onChange={(event) => { setGap(Number(event.target.value)); setConfirmed(false); }} className="ml-2 w-20 rounded border border-cui-border p-1" /></label>
        {needed.map((field) => <label key={field} className="block text-xs font-semibold">{field.replace(/_/g, ' ')}<input value={facts[field] ?? ''}
          maxLength={2000} onChange={(event) => { setFacts({ ...facts, [field]: event.target.value }); setConfirmed(false); }}
          className="mt-1 w-full rounded border border-cui-border p-2 text-sm" /></label>)}
        {steps.map((template, index) => <div key={index} className="rounded border border-cui-border p-2 text-xs">
          <p className="font-semibold">Step {index + 1}: {template?.name ?? 'Template unavailable'}</p>
          {template ? <><p className="font-semibold">{renderSalesTemplate(template, 'email', facts).subject}</p>
            {template.email_design ? <EmailDesignPreview body={renderSalesTemplate(template, 'email', facts).body} design={template.email_design} />
              : <p className="whitespace-pre-wrap">{renderSalesTemplate(template, 'email', facts).body}</p>}</> : null}
        </div>)}
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={approveAll} disabled={emailProvider !== 'gmail'}
          onChange={(event) => { setApproveAll(event.target.checked); setConfirmed(false); }} />Send all reviewed steps automatically from my Gmail.</label>
        <p className="text-xs text-cui-muted">Pause here when someone replies in Gmail. Unsubscribes and replies recorded in the CRM stop follow-ups.</p>
        <label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed these steps, timing and facts.</label>
        <button type="button" disabled={!confirmed || steps.some((step) => !step) || Boolean(definition.requires && !evidence)}
          onClick={() => void save()} className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{approveAll ? 'Start reviewed Gmail sequence' : 'Create review-first sequence'}</button>
      </fieldset>
    </div>
  ;
  return embedded ? content : <ConversationTool label="Sequences" title="Follow-up sequences" large>{content}</ConversationTool>;
}
