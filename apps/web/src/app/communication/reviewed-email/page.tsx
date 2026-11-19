'use client';

import { useEffect, useState } from 'react';
import ScheduleSend from '../../../components/crm/ScheduleSend';
import MessageComposer from '../../../components/crm/MessageComposer';
import SectionLayout from '../../../components/crm/SectionLayout';
import { Card, CardBody } from '../../../components/ui/Card';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import { isRecord } from '../../../lib/workspace-validation';
import { useUnsavedChanges } from '../../../context/WorkspaceNavigationContext';

interface Contact { id: string; full_name: string; email: string }
interface Draft { contact: Contact; subject: string; body: string; reviewed: boolean; busy: boolean; queued: boolean }

export default function ReviewedEmailPage(): JSX.Element {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  useUnsavedChanges(drafts.some((draft) => !draft.queued && Boolean(draft.subject || draft.body)));
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [search, setSearch] = useState('');
  const load = async (): Promise<void> => {
    setLoading(true); setError('');
    try {
      const data = await workspaceFetch<unknown>('/api/leads?limit=1000');
      if (!Array.isArray(data) || data.some((row: unknown) => !isRecord(row) || typeof row.id !== 'string' || typeof row.full_name !== 'string')) {
        throw new Error('The server returned an invalid contact list.');
      }
      const rows: Contact[] = [];
      for (const row of data) {
        if (isRecord(row) && typeof row.id === 'string' && typeof row.full_name === 'string' && typeof row.email === 'string' && row.email.trim()) {
          rows.push({ id: row.id, full_name: row.full_name, email: row.email });
        }
      }
      setContacts(rows);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Contacts could not be loaded.');
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const update = (id: string, patch: Partial<Omit<Draft, 'contact'>>): void => {
    setDrafts((current) => current.map((draft) => draft.contact.id === id ? { ...draft, ...patch } : draft));
  };
  const select = (contact: Contact): void => {
    const removing = drafts.find((draft) => draft.contact.id === contact.id);
    if (removing && (removing.subject || removing.body) && !window.confirm('Discard this unsent email?')) return;
    setDrafts((current) => current.some((draft) => draft.contact.id === contact.id)
      ? current.filter((draft) => draft.contact.id !== contact.id)
      : [...current, { contact, subject: '', body: '', reviewed: false, busy: false, queued: false }]);
  };
  return <SectionLayout title="Reviewed Gmail Emails"><div className="space-y-5">
    {error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {error} <button type="button" className="ml-2 underline" onClick={() => void load()}>Retry</button>
    </div>}
    <div className="grid gap-5 xl:grid-cols-[20rem_1fr]">
      <Card><CardBody>
        <label className="block text-sm font-medium">Find contacts
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-2 w-full rounded border border-cui-border bg-cui-surface px-3 py-2" />
        </label>
        <p className="my-3 text-sm text-cui-muted">{drafts.length} selected</p>
        {loading ? <p className="text-sm text-cui-muted">Loading contacts...</p> : <div className="max-h-[36rem] space-y-2 overflow-y-auto">
          {contacts.filter((contact) => `${contact.full_name} ${contact.email}`.toLowerCase().includes(search.toLowerCase())).map((contact) => {
            const selected = drafts.find((draft) => draft.contact.id === contact.id);
            return <label key={contact.id} className="flex items-start gap-2 rounded border border-cui-border p-2 text-sm">
              <input type="checkbox" aria-label={`Select ${contact.full_name}`} checked={!!selected}
                disabled={selected?.busy || selected?.queued || (!selected && drafts.length >= 50)} onChange={() => select(contact)} />
              <span className="min-w-0 break-words">{contact.full_name}<span className="block text-xs text-cui-muted">{contact.email}</span></span>
            </label>;
          })}
          {!contacts.length && <p className="text-sm text-cui-muted">No contacts with an email address.</p>}
        </div>}
      </CardBody></Card>
      <section className="min-w-0 space-y-4" aria-label="Selected email drafts">
        {!drafts.length && <p className="text-sm text-cui-muted">Select contacts to compose their emails.</p>}
        {drafts.map((draft) => <article key={draft.contact.id}><Card><CardBody className="space-y-3">
          <h2 className="font-semibold">{draft.contact.full_name}</h2>
          <p className="break-all text-sm text-cui-muted">{draft.contact.email}</p>
          <MessageComposer subject={draft.subject} body={draft.body} disabled={draft.busy || draft.queued}
            subjectLabel={`Subject for ${draft.contact.full_name}`} bodyLabel={`Message for ${draft.contact.full_name}`}
            onSubjectChange={(subject) => update(draft.contact.id, { subject, reviewed: false })}
            onBodyChange={(body) => update(draft.contact.id, { body, reviewed: false })}
            schedule={<ScheduleSend conversationKey={`lead:${draft.contact.id}`} emailProvider="gmail" subject={draft.subject} body={draft.body}
              disabled={!draft.reviewed || draft.busy || draft.queued} onBusy={(busy) => update(draft.contact.id, { busy })}
              onScheduled={() => update(draft.contact.id, { queued: true })}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={draft.reviewed} disabled={draft.busy || draft.queued || !draft.subject.trim() || !draft.body.trim()}
                  onChange={(event) => update(draft.contact.id, { reviewed: event.target.checked })} />
                Reviewed email for {draft.contact.full_name}
              </label>
            </ScheduleSend>} />
        </CardBody></Card></article>)}
      </section>
    </div>
  </div></SectionLayout>;
}
