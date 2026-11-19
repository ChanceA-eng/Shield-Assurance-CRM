'use client';

import { useEffect, useRef, useState } from 'react';
import { uploadAccountDocument, downloadAccountDocument, type AccountDocumentView } from '../../lib/account-document-client';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import { isRecord } from '../../lib/workspace-validation';
import { formatArizonaDateTime } from '../../lib/arizona-time';

export function PlacementDocumentPicker({ accountId, value, onChange, onBusyChange }: {
  accountId: string; value: string; onChange: (id: string) => void; onBusyChange?: (busy: boolean) => void;
}): JSX.Element {
  const [documents, setDocuments] = useState<AccountDocumentView[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const file = useRef<File | null>(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { onBusyChange?.(uploading); return () => onBusyChange?.(false); }, [uploading, onBusyChange]);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void workspacePages<AccountDocumentView>(`/api/clients/${accountId}/files?scope=placement`, 100, 'page')
      .then((rows) => { if (active) setDocuments(rows.filter((item) => item.source_kind === 'stored' && item.status === 'stored')); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Account documents could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, refresh]);
  const upload = async (): Promise<void> => {
    if (uploading) return;
    if (!file.current) { setError('Select a file before uploading.'); return; }
    setUploading(true); setError('');
    const result = await uploadAccountDocument(accountId, file.current);
    if (!active.current) return;
    if (!result.ok) setError(result.message);
    else {
      setDocuments((previous) => [result.document, ...previous.filter((item) => item.id !== result.document.id)]);
      onChange(result.document.id); file.current = null;
    }
    setUploading(false);
  };
  return <div className="space-y-2">
    <label className="block text-xs font-semibold">Uploaded account document
      <select aria-label="Uploaded account document" disabled={loading || uploading} value={value}
        onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded border border-cui-border px-2 py-2 text-sm">
        <option value="">No document selected</option>
        {documents.map((document) => <option key={document.id} value={document.id}>{document.file_name}</option>)}
      </select>
    </label>
    {loading ? <p role="status" className="text-xs text-cui-muted">Loading uploaded documents...</p> : null}
    <label className="block text-xs">Upload a new document
      <input aria-label="Upload placement document" type="file" disabled={uploading}
        onChange={(event) => { file.current = event.target.files?.[0] ?? null; }} className="block w-full text-xs" />
    </label>
    <button type="button" disabled={uploading} onClick={() => void upload()} className="text-xs font-semibold text-cui-primary disabled:opacity-50">
      {uploading ? 'Uploading document...' : 'Upload selected file'}
    </button>
    {error ? <p role="alert" className="text-xs text-cui-danger">{error}
      <button type="button" onClick={() => setRefresh((previous) => previous + 1)} className="ml-2 underline">Retry documents</button></p> : null}
  </div>;
}

interface DocumentLink {
  id: string; file_id: string; file_snapshot: Record<string, unknown>; added_by: string; added_at: string;
}

export default function PlacementDocuments({ accountId, type, recordId }: {
  accountId: string; type: 'quote' | 'policy'; recordId: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [documents, setDocuments] = useState<DocumentLink[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const endpoint = `/api/placement-documents?account_id=${accountId}&type=${type}&id=${recordId}`;
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError('');
    void workspacePages<DocumentLink>(endpoint, 100, 'page').then((rows) => { if (active) setDocuments(rows); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Placement documents could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, endpoint, refresh]);
  const attach = async (): Promise<void> => {
    setLoading(true); setError('');
    try {
      await workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_id: selected }) });
      setSelected(''); setRefresh((previous) => previous + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Document attachment failed. Retry with the same selection.'); }
    finally { setLoading(false); }
  };
  return <section className="mt-3 border-t border-cui-border pt-3">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="text-xs font-semibold text-cui-primary">
      {open ? 'Hide' : 'View'} {type} documents
    </button>
    {open ? <div className="mt-2 space-y-3">
      {documents.map((document) => <div key={document.id} className="rounded border border-cui-border p-2 text-sm">
        <button type="button" className="font-semibold text-cui-primary underline" onClick={() => {
          void downloadAccountDocument({ file_name: typeof document.file_snapshot.file_name === 'string' ? document.file_snapshot.file_name : 'Document',
            download_url: `/api/clients/${accountId}/files/${document.file_id}/download` })
            .then((result) => { if (!result.ok) setError(result.message); });
        }}>{isRecord(document.file_snapshot) && typeof document.file_snapshot.file_name === 'string' ? document.file_snapshot.file_name : 'Document'}</button>
        <p className="text-xs text-cui-muted">{document.added_by} · {formatArizonaDateTime(document.added_at)}</p>
      </div>)}
      {!loading && !error && !documents.length ? <p className="text-xs text-cui-muted">No linked documents.</p> : null}
      {loading ? <p role="status" className="text-xs text-cui-muted">Loading documents...</p> : null}
      {error ? <p role="alert" className="text-xs text-cui-danger">{error}
        <button type="button" onClick={() => setRefresh((previous) => previous + 1)} className="ml-2 underline">Refresh document links</button></p> : null}
      <PlacementDocumentPicker accountId={accountId} value={selected} onChange={setSelected} onBusyChange={setUploading} />
      <button type="button" disabled={!selected || loading || uploading} onClick={() => void attach()}
        className="rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Link document to {type}</button>
    </div> : null}
  </section>;
}
