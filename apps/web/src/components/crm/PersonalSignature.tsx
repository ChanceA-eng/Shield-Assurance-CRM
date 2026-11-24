'use client';
import { useEffect, useRef, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { documentFromText, emailDocumentText, type EmailDocument, type EmailRow } from '@crm/shared';
import EmailTextEditor from './EmailTextEditor';
import EmailBlockWorkspace, { initialEmailRows } from './EmailBlockWorkspace';
import EmailDesignPreview from './EmailDesignPreview';
export default function PersonalSignature(): JSX.Element {
  const [signature, setSignature] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [savedSignature, setSavedSignature] = useState('');
  const [document, setDocument] = useState<EmailDocument>();
  const [rows, setRows] = useState<EmailRow[]>();
  const [savedDesign, setSavedDesign] = useState('');
  const [uploading, setUploading] = useState(false);
  useUnsavedChanges(ready && (signature !== savedSignature || JSON.stringify({ document, rows }) !== savedDesign));
  const loadVersion = useRef(0);
  const load = (): void => {
    const version = ++loadVersion.current;
    setError(''); setReady(false);
    void workspaceFetch<{ signature: string; signatureDocument?: EmailDocument; signatureRows?: EmailRow[] }>('/api/account').then((result) => {
      if (version === loadVersion.current) {
        const document = result.signatureDocument ?? documentFromText(result.signature);
        setSignature(result.signature); setDocument(document); setRows(result.signatureRows);
        setSavedDesign(JSON.stringify({ document, rows: result.signatureRows })); setSavedSignature(result.signature); setReady(true);
      }
    }).catch((failure: unknown) => {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Signature could not load.');
    });
  };
  useEffect(() => { load(); return () => { loadVersion.current++; }; }, []);
  return <Card><CardHeader>My email signature</CardHeader><CardBody>
    {error ? <p role="alert" className="mb-3 text-sm text-cui-danger">{error} {!ready ? <button type="button" className="underline" onClick={load}>Retry</button> : null}</p> : null}
    {notice ? <p role="status" className="mb-3 text-sm text-green-800">{notice}</p> : null}
    <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); if (!ready || busy || uploading) return; setBusy(true); setError(''); setNotice('');
      void workspaceFetch<{ message: string }>('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature, signatureDocument: document, signatureRows: rows }) }).then((result) => {
          if (!signature.trim()) setRows(undefined);
          setSavedSignature(signature); setSavedDesign(JSON.stringify({ document, rows: signature.trim() ? rows : undefined })); setNotice(result.message);
        })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Signature could not save.'))
        .finally(() => setBusy(false));
    }}>
      <div className="grid items-start gap-4 lg:grid-cols-2">
      <fieldset disabled={busy || !ready || uploading} className="min-w-0 space-y-3">
      <EmailTextEditor label="Signature" value={document} disabled={busy || !ready || uploading} onChange={(value) => {
        setDocument(value); setSignature(emailDocumentText(value)); setNotice('');
      }} />
      {rows ? <EmailBlockWorkspace rows={rows} onChange={setRows} onBusy={setUploading} bodyLabel="Signature text"
        imageEndpoint="/api/account/signature-image" /> : <button type="button" className="crm-button" onClick={() => setRows(initialEmailRows())}>Add signature layout, images and buttons</button>}
      {rows ? <button type="button" className="crm-button" onClick={() => {
        if (window.confirm('Remove the signature layout, including its images and buttons? Save to keep the change.')) setRows(undefined);
      }}>Remove signature layout</button> : null}
      </fieldset>
      <div className="min-w-0 rounded border border-cui-border bg-cui-light p-3 lg:sticky lg:top-3">
        {ready && signature ? <EmailDesignPreview body={`-- \n${signature}`}
          formatting={{ signatureDocument: document, signatureRows: rows }} /> : <p className="text-sm text-cui-muted">Your signature preview will appear here.</p>}
      </div>
      </div>
      <p className="text-xs text-cui-muted">Used for your emails. Leave text blank to remove the custom signature and use the agency default.</p>
      <button disabled={busy || !ready || uploading} className="rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Saving...' : 'Save my signature'}</button>
    </form>
  </CardBody></Card>;
}
