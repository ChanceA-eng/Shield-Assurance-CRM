'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OutreachSender, GmailConnectionStatus } from '@crm/shared';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useUnsavedChanges, useWorkspaceNavigation } from '../../context/WorkspaceNavigationContext';

interface Member {
  user_id: string; email: string; role: 'owner' | 'admin' | 'agent'; active: boolean;
  sender_profile: OutreachSender | null; gmail_ai_opt_in?: boolean;
}
interface Team { member: Member; members: Member[]; gmail_ai_enabled: boolean }
const blankSender: OutreachSender = { name: '', role: 'Insurance producer', agency: 'Shield Assurance', service_area: '', specialties: '', tone: 'Warm, clear and concise', signature: '', approved_claims: '' };
const input = 'crm-input mt-1';

export default function AgentCommunicationSettings(): JSX.Element {
  const { confirmLeave } = useWorkspaceNavigation();
  const [team, setTeam] = useState<Team | null>(null);
  const [profile, setProfile] = useState<OutreachSender>(blankSender);
  const [optIn, setOptIn] = useState(false);
  const [mailbox, setMailbox] = useState<GmailConnectionStatus | null>(null);
  const [review, setReview] = useState<Array<{ gmail_thread_id: string; reason: string }>>([]);
  const [gmailError, setGmailError] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState('');
  const snapshot = JSON.stringify({ profile, optIn });
  useUnsavedChanges(Boolean(team) && snapshot !== baseline);
  const loadMailbox = useCallback(async () => {
    try {
      const gmail = await workspaceFetch<{ connection: GmailConnectionStatus | null; review: typeof review }>('/api/gmail');
      setMailbox(gmail.connection); setReview(gmail.review); setGmailError('');
    } catch (failure) { setGmailError(failure instanceof Error ? failure.message : 'Unable to load Gmail connection.'); }
  }, []);
  const load = useCallback(async () => {
    try {
      const data = await workspaceFetch<Team>('/api/agency');
      setTeam(data); setProfile(data.member.sender_profile ?? blankSender); setOptIn(data.member.gmail_ai_opt_in ?? false);
      setBaseline(JSON.stringify({ profile: data.member.sender_profile ?? blankSender, optIn: data.member.gmail_ai_opt_in ?? false }));
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to load agency profile.'); }
    await loadMailbox();
  }, [loadMailbox]);
  useEffect(() => { void load(); }, [load]);
  const act = async (operation: () => Promise<void>): Promise<void> => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Action could not be completed.'); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader>My agent account &amp; Gmail</CardHeader><CardBody className="space-y-4">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="text-sm text-green-700">{notice}</p> : null}
    {!team ? <button type="button" onClick={() => void load()} className="text-sm text-cui-primary underline">Reload account settings</button> : <>
      <p className="text-sm text-cui-muted">{team.member.email} · {team.member.role}</p>
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => {
        event.preventDefault(); void act(async () => {
          await workspaceFetch('/api/agency', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sender_profile: profile, gmail_ai_opt_in: optIn }) });
          setBaseline(snapshot);
          setNotice('Agent profile saved.');
        });
      }}>
        {([['name', 'My display name'], ['role', 'My role / title'], ['agency', 'Agency name'], ['service_area', 'My service area'], ['specialties', 'My specialties'], ['tone', 'My writing style'], ['signature', 'My signature'], ['approved_claims', 'Agency-approved claims']] as const).map(([key, label]) =>
          <label key={key} className="text-xs font-semibold text-cui-muted">{label}<textarea readOnly={key === 'agency' || key === 'approved_claims'} required={['name', 'agency', 'signature'].includes(key)} rows={2} maxLength={1000} value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })} className={input} /></label>)}
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={optIn} disabled={!team.gmail_ai_enabled} onChange={(event) => setOptIn(event.target.checked)} />
          Permit my CRM-linked Gmail message content to be used for communication drafts by the configured AI provider. No training on mailbox data. {team.gmail_ai_enabled ? 'This does not authorize use of another agent’s mailbox content.' : 'Disabled until provider/privacy approval is completed.'}</label>
        <div><button disabled={busy} className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">Save my profile</button></div>
      </form>
      <section className="space-y-3 border-t border-cui-border pt-4">
        <h3 className="text-sm font-bold text-cui-text">Connected Gmail</h3>
        {gmailError ? <p className="text-sm text-cui-muted">{gmailError}</p> : null}
        <p className="text-sm">{mailbox ? `${mailbox.email} · ${mailbox.status}` : 'No Gmail mailbox connected.'}</p>
        {mailbox?.last_error ? <p role="alert" className="text-sm text-cui-danger">Gmail needs attention. Reconnect or ask Rashi.</p> : null}
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
          I authorize Gmail read/send access and agency sharing of entire conversations matching CRM contact emails. Google grants mailbox-wide read access; unrelated mail is not retained. Ambiguous threads require review. AI use is separate.</label>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || !accepted} className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void act(async () => {
            const result = await workspaceFetch<{ url: string }>('/api/gmail/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept_shared_crm_sync: true }) });
            if (confirmLeave()) window.location.assign(result.url);
          })}>{mailbox ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          {mailbox?.status === 'connected' ? <button type="button" disabled={busy} className="rounded border border-cui-border px-3 py-1.5 text-sm" onClick={() => void act(async () => {
            const result = await workspaceFetch<{ message: string }>('/api/gmail/sync', { method: 'POST' }); setNotice(result.message);
          })}>Request sync</button> : null}
          {mailbox && mailbox.status !== 'disconnected' ? <button type="button" disabled={busy} className="rounded border border-cui-danger px-3 py-1.5 text-sm text-cui-danger" onClick={() => void act(async () => {
            const result = await workspaceFetch<{ message: string }>('/api/gmail', { method: 'DELETE' }); await loadMailbox(); setNotice(result.message);
          })}>Disconnect Gmail</button> : null}
          <button type="button" onClick={() => void loadMailbox()} className="px-3 py-1.5 text-sm text-cui-primary underline">Refresh status</button>
        </div>
        {review.length ? <ul className="space-y-1 text-xs text-cui-muted">{review.map((item) => <li key={item.gmail_thread_id}><a target="_blank" rel="noreferrer" className="text-cui-primary underline" href={`https://mail.google.com/mail/u/${encodeURIComponent(mailbox?.email ?? '')}/#all/${encodeURIComponent(item.gmail_thread_id)}`}>Review in Gmail</a>: {item.reason}</li>)}</ul> : null}
      </section>
    </>}
  </CardBody></Card>;
}
