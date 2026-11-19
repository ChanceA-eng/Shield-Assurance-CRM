'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { Card, CardBody, CardHeader } from '../ui/Card';
import TeamAccessWorkspace from './TeamAccessWorkspace';
import type { TeamManagementData } from '../../lib/team-management';
import AskRashi from './AskRashi';

interface Member { user_id: string; email: string; role: 'owner' | 'admin' | 'agent'; active: boolean }
interface Team { member: Member; members: Member[]; enabled: boolean; can_invite: boolean; issues: string[] }

export default function AgencyTeamSettings(): JSX.Element {
  const [team, setTeam] = useState<Team | null>(null);
  const [managedTeam, setManagedTeam] = useState<TeamManagementData | null>(null);
  const [email, setEmail] = useState('');
  const [confirmAccess, setConfirmAccess] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [notice, setNotice] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const { confirmDiscard, markSaved } = useUnsavedChanges(inviting && Boolean(email.trim()));
  const closeInvite = (): void => {
    if (busy || !confirmDiscard()) return;
    setInviting(false); setEmail(''); setConfirmAccess(false); setInviteError('');
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const current = await workspaceFetch<Team & { management?: TeamManagementData }>('/api/agency?team=true', { signal: AbortSignal.timeout(15000) });
      setManagedTeam(current.management?.ready ? current.management : null);
      setTeam(current); setError('');
    }
    catch (failure) {
      setError(failure instanceof Error
        ? failure.name === 'TimeoutError' ? 'Members took too long to load. Try again.' : failure.message
        : 'Team could not be loaded.');
    }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const change = async (member: Member, role: Member['role'], active: boolean): Promise<void> => {
    if (!window.confirm(`Change ${member.email} to ${role}, ${active ? 'active' : 'inactive'}? Access changes take effect immediately.`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await workspaceFetch('/api/agency', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: member.user_id, role, active }),
      });
      setNotice('Team access updated.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Team could not be updated.'); }
    finally { setBusy(false); }
  };
  const invite = async (): Promise<void> => {
    if (busy || !team?.can_invite || !confirmAccess) return;
    setBusy(true); setInviteError(''); setNotice('');
    try {
      await workspaceFetch('/api/agency', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), confirm_crm_access: true }),
      });
      markSaved(); setEmail(''); setConfirmAccess(false); setNotice('Invitation sent.');
      await load();
      setInviting(false);
    } catch (failure) { setInviteError(failure instanceof Error ? failure.message : 'Invitation could not be issued.'); }
    finally { setBusy(false); }
  };
  if (managedTeam) return <TeamAccessWorkspace initial={managedTeam} />;
  return <Card><CardHeader actions={
    <button ref={trigger} type="button" onClick={() => { setInviting(true); setInviteError(''); }}
      disabled={!team || busy} className="crm-button-primary"><Plus className="h-4 w-4" />Invite member</button>
  }>Team</CardHeader><CardBody className="space-y-4">
    {error ? <p role="alert" className="text-sm text-cui-danger">{error} <button type="button" disabled={busy || loading} onClick={() => void load()} className="font-semibold underline">Retry team</button></p> : null}
    {notice ? <p role="status" className="text-sm text-cui-success">{notice}</p> : null}
    {loading && !team ? <p role="status" className="text-sm text-cui-muted">Loading members...</p> : null}
    {team && !team.can_invite ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-cui-warning/40 bg-cui-warning/10 p-3">
      <p className="text-sm font-semibold">Invitations need setup before you can add a member.</p>
      <button type="button" onClick={() => setInviting(true)} className="crm-button">Review setup</button>
    </div> : null}
    {team ? <ul className="divide-y divide-cui-border">{team.members.map((member) => <li key={member.user_id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
      <div className="min-w-0 flex-1"><p className="break-all font-semibold">{member.email}{member.user_id === team.member.user_id ? ' (you)' : ''}</p>
        <p className="text-xs text-cui-muted">{member.active ? 'Active' : 'Inactive'}</p></div>
      {member.role === 'owner' ? <span className="font-semibold">Owner</span> : <>
      <select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy || !team.enabled} className="crm-input w-auto" onChange={(event) => {
        const role = event.target.value;
        if (role === 'admin' || role === 'agent') void change(member, role, member.active);
      }}><option value="agent">Agent</option><option value="admin">Admin</option></select>
      <button type="button" disabled={busy || !team.enabled} onClick={() => void change(member, member.role, !member.active)}
        className="crm-button">{member.active ? 'Deactivate' : 'Reactivate'}</button></>}
    </li>)}</ul> : null}
    <Dialog.Root open={inviting} onOpenChange={(open) => { if (!open) closeInvite(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm" />
        <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}
          className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,34rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
          <div className="mb-4 flex items-center justify-between gap-3"><Dialog.Title className="text-lg font-bold">Invite member</Dialog.Title>
            <button type="button" onClick={closeInvite} disabled={busy} aria-label="Close member invitation" className="crm-button p-2"><X className="h-4 w-4" /></button></div>
          <Dialog.Description className="mb-4 text-sm text-cui-muted">Invite a producer to this agency. Limited-access roles are not available yet.</Dialog.Description>
          {team?.can_invite ? <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void invite(); }}>
            <label className="block text-sm font-semibold">Member email
              <input autoFocus required type="email" maxLength={254} disabled={busy} value={email} onChange={(event) => setEmail(event.target.value)} className="crm-input mt-1" />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" required checked={confirmAccess} disabled={busy} onChange={(event) => setConfirmAccess(event.target.checked)} />
              Give this member access to agency customer records.
            </label>
            {inviteError ? <p role="alert" className="text-sm text-cui-danger">{inviteError}</p> : null}
            <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={closeInvite} className="crm-button">Cancel</button>
              <button type="submit" disabled={busy || !email.trim() || !confirmAccess} className="crm-button-primary">{busy ? 'Sending invitation...' : 'Send invitation'}</button></div>
          </form> : <div className="space-y-4">
            <p className="text-sm">Invitations are unavailable.</p>
            <div className="flex flex-wrap justify-end gap-2">
              <AskRashi topic="team" label="Resolve setup with Rashi" detail={team?.issues.join('\n')}
                onOpen={() => setInviting(false)} />
              <button type="button" disabled={loading} onClick={() => void load()} className="crm-button-primary">{loading ? 'Checking...' : 'Check setup again'}</button>
            </div>
            {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
            {inviteError ? <p role="alert" className="text-sm text-cui-danger">{inviteError}</p> : null}
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </CardBody></Card>;
}
