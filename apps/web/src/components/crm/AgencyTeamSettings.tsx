'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { TEAM_PERMISSIONS, teamScopeIncludes, type TeamAccess, type TeamScope } from '@crm/shared';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { TEAM_PROFILE_PERMISSIONS } from '../../lib/team-profile-permissions';
import type { TeamMember, TeamSettingsData } from '../../lib/team-settings';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody } from '../ui/Card';

const endpoint = '/api/agency?team=true';
const pageSize = 10;
const labels = {
  team_profile_invited: 'Setup requested',
  team_profile_updated: 'Access updated',
  team_profile_activated: 'Setup completed',
  team_setup_email_accepted: 'Email accepted by provider',
  team_setup_email_unconfirmed: 'Email acceptance unconfirmed',
  team_profile_revoked: 'Invitation revoked',
} as const;
const permissionKeys = Object.keys(TEAM_PROFILE_PERMISSIONS) as (keyof typeof TEAM_PROFILE_PERMISSIONS)[];
const setupPending = (member: TeamMember): boolean => member.setup_state === 'pending' || member.setup_state === 'delivery_failed' || member.setup_state === 'sent';
const accessLabel = (member: TeamMember): string => {
  if (member.active) return 'Active access';
  if (member.setup_state === 'sent') return 'Awaiting setup';
  if (member.setup_state === 'pending') return 'Setup requested';
  if (member.setup_state === 'delivery_failed') return 'Delivery unconfirmed';
  if (member.setup_state === 'revoked') return 'Invitation revoked';
  return 'Deactivated';
};

function PermissionGrid({ value, onChange, heading, disabled, ceiling }: {
  value: TeamAccess; onChange: (access: TeamAccess) => void; heading: string; disabled: boolean; ceiling?: TeamAccess | null;
}): JSX.Element {
  return <fieldset disabled={disabled}>
    <legend className="mb-3 text-sm font-bold">{heading}</legend>
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {permissionKeys.map((key) => {
        const scopes: readonly TeamScope[] = TEAM_PERMISSIONS[key].scopes.filter((scope) =>
          !ceiling || Boolean(ceiling[key] && teamScopeIncludes(ceiling[key]!, scope)));
        const label = TEAM_PROFILE_PERMISSIONS[key];
        return <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cui-border px-3 py-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={scopes.length === 0} checked={Boolean(value[key])} onChange={(event) => {
            const next = { ...value };
            if (event.target.checked) next[key] = scopes.includes('assigned') ? 'assigned' : scopes[0];
            else delete next[key];
            onChange(next);
          }} />{label}</label>
          {value[key] && scopes.length > 1 && <select className="crm-input w-auto" aria-label={`${label} scope`}
            value={value[key]} onChange={(event) => {
              const nextScope = scopes.find((scope) => scope === event.target.value);
              if (nextScope) onChange({ ...value, [key]: nextScope });
            }}>
            {scopes.map((scope) => <option key={scope} value={scope}>{scope === 'agency' ? 'Agency-wide' : scope === 'assigned' ? 'Assigned only' : 'Own only'}</option>)}
          </select>}
        </div>;
      })}
    </div>
  </fieldset>;
}

export default function AgencyTeamSettings({ initial }: { initial: TeamSettingsData | null }): JSX.Element {
  const [team, setTeam] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [grants, setGrants] = useState<TeamAccess>({});
  const [editing, setEditing] = useState<{ member: TeamMember; title: string; grants: TeamAccess; active: boolean } | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [access, setAccess] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial ? '' : 'Team access could not load.');
  const [notice, setNotice] = useState('');
  const { confirmDiscard } = useUnsavedChanges(Boolean(name || email || title || Object.keys(grants).length || editing));
  const refresh = async (): Promise<void> => { setTeam(await workspaceFetch<TeamSettingsData>(endpoint)); };
  const run = async (command?: object, message?: string, saved?: () => void): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    let failure = '';
    try {
      if (command) {
        await workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
        setNotice(message ?? 'Saved.'); saved?.();
      }
    } catch (problem) { failure = problem instanceof Error ? problem.message : 'Team changes could not be saved.'; }
    try { await refresh(); }
    catch (problem) {
      failure = [failure, problem instanceof Error ? `Could not refresh Team: ${problem.message}` : 'Could not refresh Team.'].filter(Boolean).join(' ');
    } finally { setError(failure); setBusy(false); }
  };
  const members = team?.members ?? [];
  const titleOf = (member: TeamMember): string => member.role === 'owner' ? 'Owner' : member.role_title ?? 'No custom title';
  const filtered = members.filter((member) => (!access || member.active === (access === 'active'))
    && titleOf(member).toLowerCase().includes(role.trim().toLowerCase())
    && `${member.team_name ?? ''} ${member.email} ${titleOf(member)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const index = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const counts = [
    ['Team profiles', members.length], ['Owner', members.filter((member) => member.role === 'owner').length],
    ['Active members', members.filter((member) => member.active && member.role !== 'owner').length],
    ['Deactivated', members.filter((member) => !member.active && !setupPending(member)).length],
  ] as const;
  const withinAuthority = (member: TeamMember): boolean => !team?.managerGrants || Boolean(member.direct_grants
    && Object.entries(member.direct_grants).every(([key, scope]) => {
      const permitted = team.managerGrants?.[key as keyof TeamAccess];
      return permitted && scope && teamScopeIncludes(permitted, scope);
    }));
  const canEdit = (member: TeamMember): boolean => member.role !== 'owner' && !member.invitation_id
    && (member.role !== 'admin' || team?.owner === true) && member.setup_state !== 'revoked' && withinAuthority(member);

  return <section aria-label="Team access" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-widest text-cui-muted">People workspace</p>
        <h2 className="text-2xl font-bold text-cui-text">Team access</h2>
        <p className="mt-1 text-sm text-cui-muted">Give each person a custom title and choose exactly what they can access.</p></div>
      <button type="button" className="crm-button" disabled={busy} onClick={() => void run()}>Reload team</button>
    </div>
    {notice && <p role="status" className="rounded-xl border border-cui-border px-4 py-3 text-sm">{notice}</p>}
    {error && !editing && <p role="alert" className="rounded-xl border border-cui-danger px-4 py-3 text-sm">{error}</p>}
    {team && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{counts.map(([label, count]) => <Card key={label}>
        <CardBody><span className="block text-xs font-bold uppercase tracking-wide text-cui-muted">{label}</span>
          <strong className="mt-1 block text-2xl">{count}</strong></CardBody>
      </Card>)}</div>
      <p className="rounded-xl border border-cui-border bg-cui-panel px-4 py-3 text-sm">A role title is a label, not a permission grant. New members start with no CRM workspace access selected.</p>
      <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault();
        if (team.invitationIssue) return;
        void run({ action: 'invite', full_name: name, email, role_title: title, grants }, 'Email accepted by the provider. Delivery is not confirmed.', () => {
          setName(''); setEmail(''); setTitle(''); setGrants({});
        });
      }}>
        <Card><CardBody><fieldset disabled={busy || Boolean(team.invitationIssue)} className="grid gap-3 lg:grid-cols-[1fr_1.2fr_1fr_auto] lg:items-end">
          <label className="text-xs font-bold uppercase tracking-wider text-cui-muted">Name<input required className="crm-input mt-1 normal-case tracking-normal" maxLength={120} placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wider text-cui-muted">Email<input required type="email" className="crm-input mt-1 normal-case tracking-normal" maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="text-xs font-bold uppercase tracking-wider text-cui-muted">Role title<input required className="crm-input mt-1 normal-case tracking-normal" maxLength={80} placeholder="Type any role title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <button type="submit" className="crm-button-primary">Send invite</button>
        </fieldset>{team.invitationIssue && <p className="mt-2 text-sm text-cui-muted">{team.invitationIssue}</p>}</CardBody></Card>
        <Card><CardBody><PermissionGrid heading="Starting permissions" disabled={busy || Boolean(team.invitationIssue)} value={grants} onChange={setGrants} ceiling={team.managerGrants} /></CardBody></Card>
      </form>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-bold">Search team<input type="search" className="crm-input mt-1" placeholder="Name, email or role title" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
        <label className="text-sm font-bold">Role title filter<input type="search" className="crm-input mt-1" placeholder="Any role title" value={role} onChange={(event) => { setRole(event.target.value); setPage(0); }} /></label>
        <label className="text-sm font-bold">Access<select className="crm-input mt-1" value={access} onChange={(event) => { setAccess(event.target.value); setPage(0); }}>
          <option value="">All access</option><option value="active">Active</option><option value="inactive">Not active</option>
        </select></label>
      </div>
      <Card><CardBody>
        {filtered.length === 0 && <p className="text-sm text-cui-muted">No team members match these filters.</p>}
        <ul className="divide-y divide-cui-border">
          {filtered.slice(index * pageSize, (index + 1) * pageSize).map((member) => <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0"><p className="break-all font-bold">{member.team_name ?? member.email}</p>
              {member.team_name && <p className="break-all">{member.email}</p>}
              <p className="text-xs text-cui-muted">{titleOf(member)} · {accessLabel(member)}{member.role === 'owner' ? ' · Unrestricted access' : ''}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {member.role === 'owner' && <span className="text-xs font-bold text-cui-muted">Protected access</span>}
              {canEdit(member) && <button type="button" className="crm-button" disabled={busy} onClick={() => {
                setError(''); setEditing({ member, title: member.role_title ?? '', grants: member.direct_grants ?? {}, active: member.active });
              }}>Edit access</button>}
              {setupPending(member) && withinAuthority(member) && <>
                <button type="button" className="crm-button" disabled={busy || Boolean(team.invitationIssue)}
                  onClick={() => void run({ action: 'resend', user_id: member.user_id }, 'Email accepted by the provider. Delivery is not confirmed.')}>Resend setup</button>
                <button type="button" className="crm-button" disabled={busy} onClick={() => {
                  if (window.confirm(`Revoke setup for ${member.email}?`)) void run({ action: 'revoke', user_id: member.user_id }, 'Invitation revoked.');
                }}>Revoke invitation</button>
              </>}
            </div>
          </li>)}
        </ul>
      </CardBody></Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-sm text-cui-muted">{filtered.length ? `${index * pageSize + 1}–${Math.min((index + 1) * pageSize, filtered.length)} of ${filtered.length}` : '0 results'}</p>
        <div className="flex gap-2">
          <button type="button" className="crm-button" disabled={!index} onClick={() => setPage(index - 1)}>Previous</button>
          <button type="button" className="crm-button" disabled={(index + 1) * pageSize >= filtered.length} onClick={() => setPage(index + 1)}>Next</button>
        </div>
      </div>
      <Card><CardBody>
        <h3 className="font-bold">Recent account and email activity</h3>
        <p className="text-sm text-cui-muted">Provider acceptance does not confirm delivery.</p>
        {team.activity.length ? <ul className="mt-3 divide-y divide-cui-border">{team.activity.map((item) => <li className="py-2 text-sm" key={item.id}>
          <span className="font-semibold">{labels[item.action as keyof typeof labels] ?? item.action}</span>
          <span className="ml-2 text-cui-muted">{members.find((member) => member.user_id === item.target_id)?.email ?? 'Former member'} · <time dateTime={item.created_at}>{item.created_at.slice(0, 10)}</time></span>
        </li>)}</ul> : <p className="mt-2 text-sm text-cui-muted">No activity recorded yet.</p>}
      </CardBody></Card>
    </>}
    <Dialog.Root open={Boolean(editing)} onOpenChange={(open) => {
      if (!open && !busy && confirmDiscard()) { setEditing(null); setError(''); }
    }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
      <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
        <Dialog.Title className="text-lg font-bold">Edit member access</Dialog.Title>
        <Dialog.Description className="mb-4 break-all text-sm text-cui-muted">{editing?.member.email}</Dialog.Description>
        {editing && <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          void run({ action: 'edit', user_id: editing.member.user_id, role_title: editing.title, grants: editing.grants,
            active: editing.active, version: editing.member.access_version }, 'Member access updated.', () => setEditing(null));
        }}>
          {!editing.member.direct_grants && <p className="text-sm text-cui-muted">Saving replaces this member&apos;s existing access with only the permissions you select below.</p>}
          <label className="block text-sm font-bold">Role title<input required maxLength={80} disabled={busy} className="crm-input mt-1" placeholder="Type any role title"
            value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
          {!setupPending(editing.member) && <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy}
            checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} />Active access</label>}
          <PermissionGrid heading="Permissions" disabled={busy} value={editing.grants} onChange={(value) => setEditing({ ...editing, grants: value })} ceiling={team?.managerGrants} />
          {error && <p role="alert" className="text-sm">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="crm-button" disabled={busy} onClick={() => { setEditing(null); setError(''); }}>Cancel</button>
            <button type="submit" className="crm-button-primary" disabled={busy}>Save access</button></div>
        </form>}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </section>;
}
