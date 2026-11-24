'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SALES_CATEGORIES, SALES_FIELDS, SALES_TEMPLATES, renderSalesTemplate, salesTemplateErrors, type SalesTemplate } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardHeader, CardBody } from '../ui/Card';
import EmailDesignEditor from './EmailDesignEditor';
import EmailDesignPreview from './EmailDesignPreview';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

const control = 'crm-input mt-1';
type TagTarget = 'subject' | 'email_body' | 'sms_body';
export default function SalesTemplateSettings(): JSX.Element {
  const [rows, setRows] = useState<SalesTemplate[]>([]);
  const [selected, setSelected] = useState<SalesTemplate | null>(null);
  const [canManage, setCanManage] = useState(false), [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [baseline, setBaseline] = useState('');
  const [tagTarget, setTagTarget] = useState<TagTarget>('email_body');
  const fields = useRef<Partial<Record<TagTarget, HTMLInputElement | HTMLTextAreaElement | null>>>({});
  const selections = useRef<Partial<Record<TagTarget, { start: number; end: number }>>>({});
  const focusFrame = useRef<number | null>(null);
  const dirty = Boolean(selected && JSON.stringify(selected) !== baseline);
  useUnsavedChanges(dirty);
  const load = useCallback(async () => {
    const data = await workspaceFetch<{ templates: SalesTemplate[]; canManage: boolean }>('/api/sales-templates');
    setRows(data.templates); setCanManage(data.canManage);
  }, []);
  useEffect(() => { void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Templates could not be loaded.')); }, [load]);
  const choose = (template: SalesTemplate | null): void => {
    if (dirty && !window.confirm('Discard unsaved template changes?')) return;
    setSelected(template); setBaseline(JSON.stringify(template)); setError(''); setNotice('');
    setTagTarget('email_body'); selections.current = {};
  };
  const rememberSelection = (target: TagTarget, element: HTMLInputElement | HTMLTextAreaElement): void => {
    if (focusFrame.current !== null) { cancelAnimationFrame(focusFrame.current); focusFrame.current = null; }
    setTagTarget(target);
    selections.current[target] = { start: element.selectionStart ?? element.value.length, end: element.selectionEnd ?? element.value.length };
  };
  const insertTag = (field: string): void => {
    if (!selected || !SALES_FIELDS.some((value) => value === field)) return;
    const text = selected[tagTarget], selection = selections.current[tagTarget] ?? { start: text.length, end: text.length };
    const token = `{{${field}}}`, next = text.slice(0, selection.start) + token + text.slice(selection.end);
    const limit = tagTarget === 'email_body' ? 10000 : 1000;
    if (next.length > limit) { setError(`This tag would exceed the ${limit}-character limit.`); return; }
    const position = selection.start + token.length;
    setSelected({ ...selected, [tagTarget]: next }); setError('');
    selections.current[tagTarget] = { start: position, end: position };
    const active = document.activeElement;
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      if (document.activeElement !== active) return;
      fields.current[tagTarget]?.focus(); fields.current[tagTarget]?.setSelectionRange(position, position);
    });
  };
  const sampleFacts = {
    contact_name: 'Contact name', agent_name: 'Agent name', agency_name: 'Your agency',
  };
  const preview = selected ? renderSalesTemplate(selected, 'email', sampleFacts) : null;
  const smsPreview = selected ? renderSalesTemplate(selected, 'sms', sampleFacts) : null;
  return <Card><CardHeader>Sales templates</CardHeader><CardBody>
    <div className="space-y-3">
      {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-green-800">{notice}</p> : null}
      <div className="flex flex-wrap gap-3">
        <label className="min-w-0 flex-1 text-xs font-semibold">Saved CRM templates
          <select aria-label="Saved CRM templates" className={control} disabled={busy || uploading} value={selected?.id ?? ''}
            onChange={(event) => choose(rows.find((row) => row.id === event.target.value) ?? null)}>
            <option value="">Choose a template</option>
            {rows.map((row) => <option key={row.id} value={row.id}>{row.name}{row.archived ? ' (archived)' : ''}</option>)}
          </select>
        </label>
        {canManage ? <button type="button" disabled={busy || uploading} className="self-end rounded border border-cui-primary px-3 py-2 text-sm text-cui-primary"
          onClick={() => choose({ id: `custom_${crypto.randomUUID().replace(/-/g, '')}`, name: '', category: 'First contact',
            subject: '', email_body: '', sms_body: '', archived: false, revision: 0, builtin: false })}>New template</button> : null}
        <button type="button" disabled={busy || uploading} className="self-end text-sm text-cui-primary underline" onClick={() => {
          if (dirty && !window.confirm('Reload saved templates and discard unsaved changes?')) return;
          setSelected(null); setBaseline(''); void load().then(() => setError('')).catch((failure: unknown) => setError(String(failure)));
        }}>Reload saved templates</button>
      </div>
      {!canManage ? <p className="text-xs text-cui-muted">Editing shared templates requires the reusable content editing permission.</p> : null}
      <Dialog.Root open={Boolean(selected)} onOpenChange={(open) => { if (!open && !busy && !uploading) choose(null); }}>
      {selected ? <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
        <Dialog.Content className="crm-shell fixed inset-2 z-[101] flex flex-col overflow-hidden rounded-lg border border-cui-border bg-cui-panel text-cui-text shadow-panel sm:inset-6">
        <div className="flex items-start justify-between gap-3 border-b border-cui-border p-4">
          <div><Dialog.Title className="text-lg font-bold">{selected.name || 'New template'}</Dialog.Title>
            <Dialog.Description className="text-sm text-cui-muted">Edit the template and review its preview before saving.</Dialog.Description></div>
          <button type="button" className="crm-button" disabled={busy || uploading} onClick={() => choose(null)} aria-label="Close template editor">Close</button>
        </div>
        <form onSubmit={(event) => {
        event.preventDefault();
        if (busy || uploading || !canManage) return;
        const errors = salesTemplateErrors(selected);
        if (errors.length) { setError(errors.join(' ')); return; }
        setBusy(true); setError(''); setNotice('');
        void workspaceFetch<SalesTemplate>('/api/sales-templates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(selected) }).then(async (saved) => {
          setSelected(saved); setBaseline(JSON.stringify(saved)); await load(); setNotice(`Saved in CRM - version ${saved.revision}.`);
        }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Template could not be saved.'))
          .finally(() => setBusy(false));
      }} className="min-h-0 flex-1 overflow-y-auto p-4">
        {error ? <p role="alert" className="mb-3 text-sm text-cui-danger">{error}</p> : null}
        {notice ? <p role="status" className="mb-3 text-sm text-green-800">{notice}</p> : null}
        <div className="grid items-start gap-4 lg:grid-cols-2">
        <fieldset disabled={busy || uploading || !canManage} className="min-w-0 space-y-3">
          <label className="block text-xs font-semibold">Template name<input required maxLength={150} className={control} value={selected.name}
            onChange={(event) => setSelected({ ...selected, name: event.target.value })} /></label>
          <label className="block text-xs font-semibold">Sales category<select className={control} value={selected.category}
            onChange={(event) => { const category = SALES_CATEGORIES.find((value) => value === event.target.value); if (category) setSelected({ ...selected, category }); }}>
            {SALES_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select></label>
          <label className="block text-xs font-semibold">Email subject<input required maxLength={1000} className={control} value={selected.subject}
            ref={(element) => { fields.current.subject = element; }} onFocus={(event) => rememberSelection('subject', event.currentTarget)}
            onSelect={(event) => rememberSelection('subject', event.currentTarget)}
            onBlur={(event) => rememberSelection('subject', event.currentTarget)}
            onChange={(event) => setSelected({ ...selected, subject: event.target.value })} /></label>
          <label className="block text-xs font-semibold">Email body<textarea required rows={7} maxLength={10000} className={control} value={selected.email_body}
            ref={(element) => { fields.current.email_body = element; }} onFocus={(event) => rememberSelection('email_body', event.currentTarget)}
            onSelect={(event) => rememberSelection('email_body', event.currentTarget)}
            onBlur={(event) => rememberSelection('email_body', event.currentTarget)}
            onChange={(event) => setSelected({ ...selected, email_body: event.target.value })} /></label>
          <EmailDesignEditor key={selected.id} value={selected.email_design} onBannerUpload={setUploading}
            onChange={(email_design) => setSelected((current) => current?.id === selected.id ? { ...current, email_design } : current)} />
          <label className="block text-xs font-semibold">Short SMS version<textarea required rows={3} maxLength={1000} className={control} value={selected.sms_body}
            ref={(element) => { fields.current.sms_body = element; }} onFocus={(event) => rememberSelection('sms_body', event.currentTarget)}
            onSelect={(event) => rememberSelection('sms_body', event.currentTarget)}
            onBlur={(event) => rememberSelection('sms_body', event.currentTarget)}
            onChange={(event) => setSelected({ ...selected, sms_body: event.target.value })} /></label>
          <label className="block text-xs font-semibold">Insert tag into {tagTarget === 'subject' ? 'email subject' : tagTarget === 'sms_body' ? 'SMS' : 'email body'}
            <select aria-label="Insert merge field" className="crm-input mt-1" value="" onChange={(event) => insertTag(event.target.value)}>
              <option value="">Choose a tag</option>{SALES_FIELDS.map((field) => <option key={field} value={field}>{field.replace(/_/g, ' ')}</option>)}</select></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={selected.archived}
            onChange={(event) => setSelected({ ...selected, archived: event.target.checked })} />Archived (hidden from composers)</label>
          <div className="flex gap-3">
            <button type="submit" className="rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white">{busy ? 'Saving...' : 'Save template'}</button>
            {selected.builtin ? <button type="button" className="text-sm text-cui-primary underline" onClick={() => {
              const starter = SALES_TEMPLATES.find((row) => row.id === selected.id);
              if (starter && window.confirm('Restore built-in content in this editor? Save to keep the change.')) setSelected({ ...starter, revision: selected.revision });
            }}>Reset to built-in</button> : null}
          </div>
        </fieldset>
        <div className="min-w-0 space-y-3 rounded border border-cui-border bg-cui-light p-3 text-sm lg:sticky lg:top-0">
          {dirty ? <p className="text-xs text-cui-warning">Unsaved changes</p> : null}
          <p className="text-xs text-cui-muted">Preview uses example details; missing tags remain visible.</p>
          <p className="mb-2 font-semibold">{preview?.subject}</p>
          <EmailDesignPreview body={preview?.body ?? ''} design={selected.email_design} />
          {preview?.missing.length ? <p className="mt-2 text-xs text-cui-muted">Details required when composing: {preview.missing.join(', ')}</p> : null}
          <h3 className="mt-3 font-semibold">SMS preview (sending not connected)</h3><p className="whitespace-pre-wrap">{smsPreview?.body}</p>
          {smsPreview?.missing.length ? <p className="text-xs text-cui-muted">SMS details required: {smsPreview.missing.join(', ')}</p> : null}
        </div>
        </div>
      </form>
      </Dialog.Content></Dialog.Portal> : null}
      </Dialog.Root>
    </div>
  </CardBody></Card>;
}
