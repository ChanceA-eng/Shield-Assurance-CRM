'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { finishPersonnelUpload, type PersonnelUpload } from '../../lib/personnel-document-client';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { Card, CardBody, CardHeader } from '../ui/Card';

interface DocumentRow {
  id: string; member_id: string; file_name: string; content_type: string; file_size: number;
  shared: boolean; retain_until: string; state: 'stored' | 'removing'; version: number; created_at: string;
}
interface Member { user_id: string; team_name: string | null; email: string }
interface UploadTicket { id: string; signed_url: string; content_type: string; confirmation: string }

export default function PersonnelDocuments({ initialMember }: { initialMember?: string }): JSX.Element {
  const [selected, setSelected] = useState(initialMember ?? '');
  const [member, setMember] = useState('');
  const [manager, setManager] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [retain, setRetain] = useState('');
  const [shared, setShared] = useState(false);
  const [pending, setPending] = useState<PersonnelUpload | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadSequence = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const { confirmDiscard } = useUnsavedChanges(Boolean(file || pending));

  const load = useCallback(async (clearError = true) => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    try {
      const suffix = selected ? `?member=${encodeURIComponent(selected)}` : '';
      const result = await workspaceFetch<{ manager: boolean; member: string; documents: DocumentRow[] }>(`/api/personnel-documents${suffix}`);
      if (sequence !== loadSequence.current) return;
      if (result.manager) {
        const list = await workspaceFetch<{ members: Member[] }>('/api/personnel-documents?members=true');
        if (sequence !== loadSequence.current) return;
        setMembers(list.members);
      }
      setManager(result.manager); setMember(result.member); setDocuments(result.documents);
      if (clearError) setError('');
    } catch (problem) {
      if (sequence === loadSequence.current) {
        setDocuments([]);
        const message = problem instanceof Error ? problem.message : 'Documents could not load.';
        setError((current) => clearError ? message : [current, message].filter(Boolean).join(' '));
      }
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [selected]);
  useEffect(() => { setDocuments([]); void load(); return () => { loadSequence.current++; }; }, [load]);
  const post = <T,>(body: object): Promise<T> => workspaceFetch<T>('/api/personnel-documents', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const upload = async (): Promise<void> => {
    if (!file || !retain || !member || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let upload = pending;
      if (!upload) {
        const ticket = await post<UploadTicket>({ action: 'ticket', member, file_name: file.name, file_size: file.size, content_type: file.type });
        upload = { ticket, member, file, retain, shared, uploaded: false };
        setPending(upload);
      }
      await finishPersonnelUpload(upload, () => setPending({ ...upload, uploaded: true }));
      setPending(null); setFile(null); setRetain(''); setShared(false); setNotice('Document uploaded.');
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Document upload failed. Retry.'); }
    finally { setBusy(false); }
  };
  const change = async (item: DocumentRow, action: 'share' | 'unshare' | 'remove'): Promise<void> => {
    if (busy || (action === 'remove' && !window.confirm(`Permanently remove ${item.file_name}?`))) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await post({ action, id: item.id, version: item.version });
      setNotice(action === 'remove' ? 'Document removed.' : 'Sharing updated.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Document change failed.'); }
    finally {
      try { await load(false); } finally { setBusy(false); }
    }
  };

  return <div className="space-y-4">
    <Card><CardHeader>Personnel documents</CardHeader><CardBody className="space-y-4">
      {manager && <label className="block text-sm font-bold">Team member<select className="crm-input mt-1" value={selected} disabled={busy || Boolean(pending)}
        onChange={(event) => {
          if (file && !confirmDiscard()) return;
          setFile(null); setRetain(''); setShared(false); setSelected(event.target.value);
        }}>
        <option value="">My documents</option>
        {members.map((person) => <option value={person.user_id} key={person.user_id}>{person.team_name ?? person.email}</option>)}
      </select></label>}
      {loading ? <p className="text-sm text-cui-muted">Loading documents...</p> : null}
      {error && <p role="alert" className="text-sm text-cui-danger">{error} <button type="button" className="underline" disabled={busy} onClick={() => void load()}>Reload</button></p>}
      {notice && <p role="status" className="text-sm text-cui-success">{notice}</p>}
      {!loading && !documents.length && !error && <p className="text-sm text-cui-muted">No documents available.</p>}
      <ul className="divide-y divide-cui-border">{documents.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
        <div><p className="font-semibold">{item.file_name}</p>{manager && <p className="text-xs text-cui-muted">
          {item.shared ? 'Shared with member' : 'Private'} · Retain through {item.retain_until}{item.state === 'removing' ? ' · Removal incomplete' : ''}
        </p>}</div>
        <div className="flex flex-wrap gap-2">
          {item.state === 'stored' && <a className="crm-button" href={`/api/personnel-documents/${encodeURIComponent(item.id)}`}>Download</a>}
          {manager && item.state === 'stored' && <button type="button" className="crm-button" disabled={busy} onClick={() => void change(item, item.shared ? 'unshare' : 'share')}>{item.shared ? 'Stop sharing' : 'Share with member'}</button>}
          {manager && <button type="button" className="crm-button-danger" disabled={busy} onClick={() => void change(item, 'remove')}>{item.state === 'removing' ? 'Retry removal' : 'Remove'}</button>}
        </div>
      </li>)}</ul>
    </CardBody></Card>
    {manager && <Card><CardHeader>Upload document</CardHeader><CardBody>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
        <label className="block text-sm font-bold">File<input ref={fileInput} type="file" required={!pending} disabled={busy || Boolean(pending)} accept=".pdf,.jpg,.jpeg,.png,.webp,.txt" className="crm-input mt-1"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <label className="block text-sm font-bold">Retain through<input type="date" required disabled={busy || Boolean(pending)} className="crm-input mt-1" value={retain} onChange={(event) => setRetain(event.target.value)} /></label>
        <p className="text-sm text-cui-muted">Choose the retention date required by your organization. Removal is blocked until that date.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy || Boolean(pending)} checked={shared} onChange={(event) => setShared(event.target.checked)} />Share this file with the member</label>
        <button className="crm-button-primary" disabled={busy || !file || !retain}>{pending ? 'Retry upload' : 'Upload'}</button>
        {pending && <button type="button" className="crm-button ml-2" disabled={busy} onClick={() => {
          if (!window.confirm('Discard this upload attempt? A file already confirmed may still appear in the list.')) return;
          setPending(null); setFile(null); setRetain(''); setShared(false); setError('');
          if (fileInput.current) fileInput.current.value = '';
          setNotice('Upload attempt discarded. Unconfirmed files are cleaned up after the upload link expires.');
          void load(false);
        }}>Discard attempt</button>}
      </form>
    </CardBody></Card>}
  </div>;
}
