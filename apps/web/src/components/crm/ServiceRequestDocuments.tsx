'use client';

import { useCallback, useEffect, useState } from 'react';
import { downloadAccountDocument, uploadAccountDocument, type AccountDocumentView } from '../../lib/account-document-client';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import { isRecord } from '../../lib/workspace-validation';

interface ServiceRequestDocument {
  id: string;
  file_id: string;
  file_snapshot: Record<string, unknown>;
  added_at: string;
  download_url: string;
}

function isServiceRequestDocument(value: unknown): value is ServiceRequestDocument {
  return isRecord(value) && typeof value.id === 'string' && typeof value.file_id === 'string'
    && isRecord(value.file_snapshot) && typeof value.added_at === 'string' && typeof value.download_url === 'string';
}

export default function ServiceRequestDocuments({ accountId, requestId }: {
  accountId: string;
  requestId: string;
}): JSX.Element {
  const [documents, setDocuments] = useState<ServiceRequestDocument[]>([]);
  const [availableFiles, setAvailableFiles] = useState<AccountDocumentView[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const endpoint = `/api/policy-change-requests/documents?account_id=${encodeURIComponent(accountId)}&request_id=${encodeURIComponent(requestId)}`;

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const [linked, files] = await Promise.all([
        workspaceFetch<unknown>(endpoint),
        workspacePages<AccountDocumentView>(`/api/clients/${encodeURIComponent(accountId)}/files?scope=placement`, 100, 'page'),
      ]);
      if (!Array.isArray(linked) || !linked.every(isServiceRequestDocument)) {
        throw new Error('The service request document response was invalid.');
      }
      setDocuments(linked);
      setAvailableFiles(files.filter((file) => file.source_kind === 'stored' && file.status === 'stored'));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Service request documents could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [accountId, endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File | undefined): Promise<void> => {
    if (!file || saving) return;
    setSaving(true);
    setError('');
    const result = await uploadAccountDocument(accountId, file);
    if (!result.ok) {
      setError(result.message);
      setSaving(false);
      return;
    }
    setAvailableFiles((current) => [result.document, ...current.filter((item) => item.id !== result.document.id)]);
    setSelectedFile(result.document.id);
    setSaving(false);
  };

  const attach = async (): Promise<void> => {
    if (!selectedFile || saving) return;
    setSaving(true);
    setError('');
    try {
      await workspaceFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, request_id: requestId, file_id: selectedFile }),
      });
      setSelectedFile('');
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The document could not be linked to this request.');
    } finally {
      setSaving(false);
    }
  };

  const linkedIds = new Set(documents.map((document) => document.file_id));
  return <section className="mt-3 border-t border-cui-border pt-3" aria-label="Service request documents">
    <h5 className="text-xs font-semibold text-cui-text">Documents</h5>
    {documents.map((document) => (
      <div key={document.id} className="mt-2 text-sm">
        <button type="button" className="font-semibold text-cui-primary underline" onClick={() => {
          void downloadAccountDocument({
            file_name: typeof document.file_snapshot.file_name === 'string' ? document.file_snapshot.file_name : 'Document',
            download_url: document.download_url,
          }).then((result) => { if (!result.ok) setError(result.message); });
        }}>
          {typeof document.file_snapshot.file_name === 'string' ? document.file_snapshot.file_name : 'Document'}
        </button>
        <span className="ml-2 text-xs text-cui-muted">{new Date(document.added_at).toLocaleDateString()}</span>
      </div>
    ))}
    {!loading && documents.length === 0 ? <p className="mt-2 text-xs text-cui-muted">No linked documents.</p> : null}
    {loading ? <p role="status" className="mt-2 text-xs text-cui-muted">Loading documents...</p> : null}
    <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]">
      <label className="text-xs font-semibold text-cui-muted">Uploaded account document
        <select aria-label="Service request document" value={selectedFile} disabled={loading || saving}
          onChange={(event) => setSelectedFile(event.target.value)}
          className="mt-1 block w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text">
          <option value="">Select a private uploaded file</option>
          {availableFiles.filter((file) => !linkedIds.has(file.id)).map((file) => (
            <option key={file.id} value={file.id}>{file.file_name}</option>
          ))}
        </select>
      </label>
      <button type="button" disabled={!selectedFile || saving || loading} onClick={() => void attach()}
        className="self-end rounded bg-cui-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
        {saving ? 'Saving...' : 'Link document'}
      </button>
    </div>
    <label className="mt-2 block text-xs text-cui-muted">Upload a new account document
      <input type="file" aria-label="Upload service request document" disabled={saving}
        onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ''; }}
        className="mt-1 block w-full text-xs" />
    </label>
    {error ? <p role="alert" className="mt-2 text-xs text-cui-danger">{error}
      <button type="button" onClick={() => void load()} className="ml-2 underline">Retry</button>
    </p> : null}
  </section>;
}
