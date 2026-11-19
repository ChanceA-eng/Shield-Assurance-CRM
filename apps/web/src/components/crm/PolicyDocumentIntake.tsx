'use client';

import React, { useEffect, useRef, useState } from 'react';
import { extractPolicyInBrowser } from '../../lib/browser-policy-extraction';
import { INTAKE_FIELDS, INTAKE_MAX_FILES, isIntakeDetail, reviewPolicySuggestions, validateIntakeFile, validateReviewedIntakeFields, type IntakeField, type LocalIntakeDocument, type ReviewedIntakeFields } from '../../lib/policy-document-intake';

export type { ReviewedIntakeFields } from '../../lib/policy-document-intake';
export default function PolicyDocumentIntake({ onReviewed, disabled = false, onProcessingChange, onSourcesChanged }: {
  onReviewed: (fields: ReviewedIntakeFields, documents: LocalIntakeDocument[]) => void;
  disabled?: boolean;
  onProcessingChange?: (processing: boolean) => void;
  onSourcesChanged?: () => void;
}): JSX.Element {
  const [documents, setDocuments] = useState<LocalIntakeDocument[]>([]);
  const [values, setValues] = useState<ReviewedIntakeFields>({});
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { onProcessingChange?.(busy); }, [busy, onProcessingChange]);
  const process = async (files: File[], forceOcr = false): Promise<void> => {
    if (busy || disabled) return;
    setError(''); setReviewed(false);
    if (files.length === 0 || files.length > INTAKE_MAX_FILES) {
      setError(`Choose between one and ${INTAKE_MAX_FILES} documents.`); return;
    }
    try { files.forEach(validateIntakeFile); } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'These files cannot be processed.'); return;
    }
    setSelectedFiles(files);
    const active = new AbortController();
    onSourcesChanged?.();
    controller.current = active; setBusy(true); setDocuments([]); setValues({}); setProgress('');
    try {
      const results: LocalIntakeDocument[] = [];
      const failures: string[] = [];
      for (const file of files) {
        setProgress(`Reading ${file.name} on this device...`);
        try {
          results.push(await extractPolicyInBrowser(file, active.signal, setProgress, { forceOcr }));
        } catch (failure) {
          if (active.signal.aborted) return;
          failures.push(`${file.name}: ${failure instanceof Error ? failure.message
            : typeof failure === 'string' ? failure : 'Document processing failed. Try a clearer file or enter its fields manually.'}`);
        }
      }
      if (active.signal.aborted) return;
      setDocuments(results);
      if (failures.length) setError(`These files could not be read and are not included in the review:\n${failures.join('\n')}`);
      const suggested = reviewPolicySuggestions(results);
      const count = Object.keys(suggested).length;
      const found = results.some((result) => result.suggestions.length > 0);
      setValues(suggested);
      setProgress(!results.length ? 'No documents could be read. Nothing was saved.'
        : found ? count ? `${count} fields ready for review. Conflicting values are left blank.`
          : 'Conflicting values were found. Check the source evidence and enter the correct values before applying.'
          : 'Text was read, but no account or policy fields were identified. Retry with OCR or inspect the extracted text below. Nothing was saved.');
    } catch (failure) {
      if (!active.signal.aborted) {
        setProgress('');
        setError(failure instanceof Error ? failure.message
          : typeof failure === 'string' ? failure : 'Document processing failed. Enter fields manually or try a clearer file.');
      }
    } finally { if (controller.current === active) { setBusy(false); controller.current = null; } }
  };
  return <details className="mb-3 rounded border border-cui-border bg-cui-light p-3">
    <summary className="cursor-pointer text-sm font-semibold text-cui-primary">Import policy documents on this device</summary>
    <p className="my-2 text-xs text-cui-muted">Up to 5 PDFs or images, 25 MB each. No PDF page-count limit. Processed privately on this device.</p>
    <input aria-label="Policy intake documents" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp"
      disabled={busy || disabled} onChange={(event) => void process(Array.from(event.target.files ?? []))} className="block w-full text-xs" />
    {progress ? <p role="status" className="mt-2 text-xs text-cui-muted">{progress}</p> : null}
    {busy ? <button type="button" className="mt-2 text-xs font-semibold text-cui-primary" onClick={() => {
      controller.current?.abort(); setProgress('Processing cancelled. Nothing was saved.');
    }}>Cancel processing</button> : null}
    {error ? <p role="alert" className="mt-2 whitespace-pre-wrap break-words text-xs text-cui-danger">{error}</p> : null}
    {selectedFiles.some((file) => file.type === 'application/pdf') && !busy ? <button type="button" disabled={disabled}
      className="mt-2 text-xs font-semibold text-cui-primary disabled:opacity-50" onClick={() => {
        if (documents.length && !window.confirm('Read these documents again using OCR? This replaces the current document review; account and policy edits are not saved or changed.')) return;
        void process(selectedFiles, true);
      }}>Retry with OCR</button> : null}
    {documents.length ? <fieldset disabled={disabled || busy} className="mt-3 space-y-3">
      {documents.map((document) => <div key={document.id} className="text-xs">
        <p className="font-semibold">{document.file.name} · {document.kind.replace('_', ' ')} · {document.pages.length} page(s)</p>
        <p className="mt-1 text-cui-muted">{document.suggestions.length} suggested values · {document.pages.filter((page) => page.method === 'ocr').length} OCR page(s)</p>
        {!document.suggestions.length ? <p role="alert" className="mt-1 text-cui-danger">No fields identified in this document. Check the extracted text or retry with OCR.</p> : null}
        {document.kind === 'id_card' ? <p className="text-cui-warning">ID card: verify the policy/declarations for full terms. Do not infer missing coverage.</p> : null}
        {document.pages.some((page) => page.confidence !== null && page.confidence < 80) ? <p className="text-cui-danger">Low-confidence OCR: check every suggested value against the original.</p> : null}
      </div>)}
      {[
        { title: 'Account and policy', fields: (Object.keys(INTAKE_FIELDS) as IntakeField[]).filter((field) => !isIntakeDetail(field)) },
        { title: 'Coverage and schedules', fields: (Object.keys(INTAKE_FIELDS) as IntakeField[]).filter(isIntakeDetail) },
      ].map((group) => <div key={group.title} className="space-y-2">
        <h3 className="border-b border-cui-border pb-1 text-xs font-semibold">{group.title}</h3>
        {group.fields.map((field) => {
          const candidates = [...new Set(documents.flatMap((document) => document.suggestions.filter((item) => item.field === field).map((item) => item.value)))];
          const multiline = isIntakeDetail(field) || field === 'full_name' || field === 'address';
          const props = {
            'aria-label': `Review ${INTAKE_FIELDS[field]}`, value: values[field] ?? '',
            maxLength: isIntakeDetail(field) ? 12000 : 1000,
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
              setValues((previous) => ({ ...previous, [field]: event.target.value })); setReviewed(false);
            },
            className: 'mt-1 w-full rounded border border-cui-border bg-white px-2 py-2 text-sm font-normal',
          };
          return <div key={field}>
            <label className="block text-xs font-semibold">Review {INTAKE_FIELDS[field]}
              {multiline ? <textarea {...props} rows={Math.min(10, Math.max(isIntakeDetail(field) ? 3 : 2, (values[field]?.split('\n').length ?? 0)))} /> : <input {...props} />}
            </label>
            {!isIntakeDetail(field) && candidates.length > 1 ? <select aria-label={`Choose ${INTAKE_FIELDS[field]}`}
              value="" className="w-full rounded border border-cui-border bg-white p-1 text-xs"
              onChange={(event) => { if (event.target.value) { setValues((previous) => ({ ...previous, [field]: event.target.value })); setReviewed(false); } }}>
              <option value="">Choose a detected value</option>
              {candidates.map((value) => <option key={value} value={value}>{value}</option>)}
            </select> : null}
          </div>;
        })}
      </div>)}
      <details className="text-xs">
        <summary className="cursor-pointer text-cui-primary">Extraction details</summary>
        {documents.map((document) => <details key={document.id} className="my-2">
          <summary className="cursor-pointer">{document.file.name}</summary>
          {document.pages.map((page) => <details key={page.page} className="my-1">
            <summary className="cursor-pointer">Page {page.page} · {page.method === 'ocr' ? 'OCR' : 'PDF text'}</summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-cui-border bg-white p-2 font-sans">{page.text || 'No readable text on this page.'}</pre>
          </details>)}
        </details>)}
      </details>
      <label className="flex items-start gap-2 text-xs">
        <input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />
        I checked these fields against the original documents.
      </label>
      <button type="button" disabled={!reviewed} onClick={() => {
        let fields: ReviewedIntakeFields;
        try { fields = validateReviewedIntakeFields(values); }
        catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the reviewed fields before applying.'); return; }
        if (!window.confirm('Apply the reviewed values to this intake? Matching fields will replace your current edits. No account or policy is saved yet.')) return;
        onReviewed(fields, documents);
      }} className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Use reviewed fields</button>
    </fieldset> : null}
  </details>;
}
