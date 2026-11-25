'use client';

import * as Dialog from '@radix-ui/react-dialog';
import Link from 'next/link';
import { useState } from 'react';
import { TEAM_PERMISSIONS, teamScopeIncludes, type TeamAccess, type TeamPermission, type TeamScope } from '@crm/shared';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { TEAM_PROFILE_PERMISSIONS } from '../../lib/team-profile-permissions';
import type { TeamMember, TeamPreset, TeamSettingsData } from '../../lib/team-settings';
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
  team_contact_updated: 'Profile updated',
  team_reset_email_accepted: 'Password reset email accepted',
  team_reset_email_unconfirmed: 'Password reset email unconfirmed',
  personnel_document_added: 'Personnel document added',
  personnel_document_share: 'Personnel document sharing changed',
  personnel_document_unshare: 'Personnel document sharing changed',
  personnel_document_remove: 'Personnel document removal started',
  personnel_document_removed: 'Personnel document removed',
  personnel_document_access_requested: 'Personnel document accessed',
} as const;
const permissionKeys = Object.keys(TEAM_PERMISSIONS) as TeamPermission[];
const permissionGroups = [...new Set(permissionKeys.map((key) => TEAM_PERMISSIONS[key].group))];
type MemberProfileSection = 'profile' | 'access' | 'security' | 'documents' | 'activity';
const setupPending = (member: TeamMember): boolean => member.setup_state === 'pending' || member.setup_state === 'delivery_failed' || member.setup_state === 'sent';
const accessCategory = (member: TeamMember): 'active' | 'awaiting' | 'issue' | 'deactivated' | 'revoked' => {
  if (member.active) return 'active';
  if (member.setup_state === 'pending' || member.setup_state === 'sent') return 'awaiting';
  if (member.setup_state === 'delivery_failed') return 'issue';
  if (member.setup_state === 'revoked') return 'revoked';
  return 'deactivated';
};
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
    <div className="space-y-5">
      {permissionGroups.map((group) => <section key={group} aria-label={`${group} permissions`}>
        <h4 className="mb-2 text-sm font-bold text-cui-text">{group}</h4>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {permissionKeys.filter((key) => TEAM_PERMISSIONS[key].group === group).map((key) => {
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
      </section>)}
    </div>
  </fieldset>;
}

export default function AgencyTeamSettings({ initial }: { initial: TeamSettingsData | null }): JSX.Element {
  const [team, setTeam] = useState(initial);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [title, setTitle] = useState('');
  const [grants, setGrants] = useState<TeamAccess>({});
  const [inviting, setInviting] = useState(false);
  const [reviewingInvite, setReviewingInvite] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [managingPresets, setManagingPresets] = useState(false);
  const [presetDraft, setPresetDraft] = useState<{ preset: TeamPreset | null; name: string; grants: TeamAccess; active: boolean } | null>(null);
  const [editing, setEditing] = useState<{ member: TeamMember; title: string; grants: TeamAccess; active: boolean } | null>(null);
  const [profile, setProfile] = useState<{
    member: TeamMember; name: string; phone: string; address: string;
    original: { name: string; phone: string; address: string };
  } | null>(null);
  const [profileSection, setProfileSection] = useState<MemberProfileSection>('profile');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [access, setAccess] = useState('current');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initial ? '' : 'Team access could not load.');
  const [notice, setNotice] = useState('');
  const profileDirty = Boolean(profile && (profile.name !== profile.original.name
    || profile.phone !== profile.original.phone || profile.address !== profile.original.address));
  const { confirmDiscard } = useUnsavedChanges(Boolean(name || email || title || Object.keys(grants).length || editing || presetDraft || profileDirty));
  const refresh = async (): Promise<void> => { setTeam(await workspaceFetch<TeamSettingsData>(endpoint)); };
  const openProfile = async (member: TeamMember): Promise<void> => {
    setBusy(true); setError('');
    try {
      const contact = await workspaceFetch<{ name: string | null; phone: string | null; address: string | null; version: number }>(
        `${endpoint}&profile=${encodeURIComponent(member.user_id)}`);
      const original = { name: contact.name ?? '', phone: contact.phone ?? '', address: contact.address ?? '' };
      setProfile({ member: { ...member, access_version: contact.version }, ...original, original });
      setProfileSection('profile');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Profile could not load.'); }
    finally { setBusy(false); }
  };
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
  const filtered = members.filter((member) => (!access || (access === 'current'
    ? !['deactivated', 'revoked'].includes(accessCategory(member)) : accessCategory(member) === access))
    && titleOf(member).toLowerCase().includes(role.trim().toLowerCase())
    && `${member.team_name ?? ''} ${member.email} ${titleOf(member)}`.toLowerCase().includes(search.trim().toLowerCase()));
  const index = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const counts = [
    ['Active members', members.filter((member) => accessCategory(member) === 'active').length],
    ['Awaiting setup', members.filter((member) => accessCategory(member) === 'awaiting').length],
    ['Setup issues', members.filter((member) => accessCategory(member) === 'issue').length],
    ['Deactivated', members.filter((member) => accessCategory(member) === 'deactivated').length],
  ] as const;
  const withinAuthority = (member: TeamMember): boolean => !team?.managerGrants || Boolean(member.direct_grants
    && Object.entries(member.direct_grants).every(([key, scope]) => {
      const permitted = team.managerGrants?.[key as keyof TeamAccess];
      return permitted && scope && teamScopeIncludes(permitted, scope);
    }));
  const canEdit = (member: TeamMember): boolean => member.role !== 'owner' && !member.invitation_id
    && (member.role !== 'admin' || team?.owner === true) && member.setup_state !== 'revoked' && withinAuthority(member);
  const profileSections = [
    { id: 'profile', label: 'Profile' },
    { id: 'access', label: 'Access' },
    { id: 'security', label: 'Security' },
    ...(team?.owner || team?.managerGrants?.['personnel.manage'] === 'agency' ? [{ id: 'documents' as const, label: 'Documents' }] : []),
    { id: 'activity', label: 'Activity' },
  ] as const;

  return <section aria-label="Team access" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-widest text-cui-muted">People workspace</p>
        <h2 className="text-2xl font-bold text-cui-text">Team access</h2>
        <p className="mt-1 text-sm text-cui-muted">Give each person a custom title and choose exactly what they can access.</p></div>
      <div className="flex gap-2">
        <button type="button" className="crm-button" disabled={busy} onClick={() => void run()}>Reload team</button>
        <button type="button" className="crm-button" disabled={busy || !team} onClick={() => setManagingPresets(true)}>Manage presets</button>
        <button type="button" className="crm-button-primary" disabled={busy || !team} onClick={() => setInviting(true)}>Add member</button>
      </div>
    </div>
    {notice && <p role="status" className="rounded-xl border border-cui-border px-4 py-3 text-sm">{notice}</p>}
    {error && !editing && !inviting && !profile && !managingPresets && <p role="alert" className="rounded-xl border border-cui-danger px-4 py-3 text-sm">{error}</p>}
    {team && <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{counts.map(([label, count]) => <Card key={label}>
        <CardBody><span className="block text-xs font-bold uppercase tracking-wide text-cui-muted">{label}</span>
          <strong className="mt-1 block text-2xl">{count}</strong></CardBody>
      </Card>)}</div>
      <p className="rounded-xl border border-cui-border bg-cui-panel px-4 py-3 text-sm">A role title is a label, not a permission grant. New members start with no CRM workspace access selected.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-bold">Search team<input type="search" className="crm-input mt-1" placeholder="Name, email or role title" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} /></label>
        <label className="text-sm font-bold">Role title filter<input type="search" className="crm-input mt-1" placeholder="Any role title" value={role} onChange={(event) => { setRole(event.target.value); setPage(0); }} /></label>
        <label className="text-sm font-bold">Access<select className="crm-input mt-1" value={access} onChange={(event) => { setAccess(event.target.value); setPage(0); }}>
          <option value="current">Current team</option><option value="">All access</option><option value="active">Active</option><option value="awaiting">Awaiting setup</option>
          <option value="issue">Setup issues</option><option value="deactivated">Deactivated</option><option value="revoked">Invitation revoked</option>
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
              {canEdit(member) && <button type="button" className="crm-button" disabled={busy} onClick={() => void openProfile(member)}>Profile</button>}
              {(team.owner || team.managerGrants?.['personnel.manage'] === 'agency') && <Link className="crm-button" href={`/account?tab=documents&member=${encodeURIComponent(member.user_id)}`}>Documents</Link>}
              {canEdit(member) && <button type="button" className="crm-button" disabled={busy} onClick={() => {
                setError(''); setEditing({ member, title: member.role_title ?? '', grants: member.direct_grants ?? {}, active: member.active });
              }}>Edit access</button>}
              {canEdit(member) && member.active && <button type="button" className="crm-button" disabled={busy} onClick={() => {
                if (window.confirm(`Send a password reset link to ${member.email}?`)) {
                  void run({ action: 'reset', user_id: member.user_id }, 'Password reset email accepted by the provider. Delivery is not confirmed.');
                }
              }}>Send password reset</button>}
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
    <Dialog.Root open={inviting} onOpenChange={(open) => {
      if (open) setInviting(true);
      else if (!busy && confirmDiscard()) { setInviting(false); setReviewingInvite(false); setSelectedPreset(''); setError(''); setName(''); setEmail(''); setTitle(''); setGrants({}); }
    }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
      <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
        <Dialog.Title className="text-lg font-bold">Add team member</Dialog.Title>
        <Dialog.Description className="mb-4 text-sm text-cui-muted">Enter their details and choose their starting access.</Dialog.Description>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          if (team?.invitationIssue) return;
          if (!Object.keys(grants).length) { setError('Choose at least one permission for this member.'); return; }
          if (!reviewingInvite) { setError(''); setReviewingInvite(true); return; }
          void run({ action: 'invite', full_name: name, email, role_title: title, grants }, 'Email accepted by the provider. Delivery is not confirmed.', () => {
            setName(''); setEmail(''); setTitle(''); setGrants({}); setSelectedPreset(''); setReviewingInvite(false); setInviting(false);
          });
        }}>
          {!reviewingInvite ? <><fieldset disabled={busy || Boolean(team?.invitationIssue)} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm font-bold">Name<input required className="crm-input mt-1" maxLength={120} placeholder="Full name" value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="text-sm font-bold">Email<input required type="email" className="crm-input mt-1" maxLength={254} placeholder="name@example.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label className="text-sm font-bold">Starting preset<select className="crm-input mt-1" value={selectedPreset} onChange={(event) => {
              const next = event.target.value;
              if ((title || Object.keys(grants).length) && !window.confirm('Replace the current role title and selected permissions?')) return;
              const preset = team?.presets.find((item) => item.id === next && item.active);
              setSelectedPreset(next); setTitle(preset?.name ?? ''); setGrants(preset ? { ...preset.grants } : {});
            }}>
              <option value="">Other (choose permissions)</option>
              {team?.presets.filter((preset) => preset.active).map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}
            </select></label>
            <label className="text-sm font-bold">Role title<input required className="crm-input mt-1" maxLength={80} placeholder="Type any role title" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          </fieldset>
          <PermissionGrid heading="Starting permissions" disabled={busy || Boolean(team?.invitationIssue)} value={grants} onChange={setGrants} ceiling={team?.managerGrants} />
          </> : <section aria-label="Invitation review" className="space-y-3">
            <h3 className="font-bold">Review invitation</h3>
            <p className="text-sm">{name} · {email} · {title}</p>
            <ul className="space-y-1 text-sm">
              {permissionKeys.filter((key) => grants[key]).map((key) => <li key={key}>
                {TEAM_PROFILE_PERMISSIONS[key]} — {grants[key] === 'agency' ? 'Agency-wide' : grants[key] === 'assigned' ? 'Assigned only' : 'Own only'}
              </li>)}
            </ul>
          </section>}
          {team?.invitationIssue && <p role="alert" className="text-sm text-cui-danger">{team.invitationIssue}</p>}
          {error && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
          <div className="flex justify-end gap-2"><Dialog.Close asChild><button type="button" className="crm-button" disabled={busy}>Cancel</button></Dialog.Close>
            {reviewingInvite && <button type="button" className="crm-button" disabled={busy} onClick={() => { setReviewingInvite(false); setError(''); }}>Back</button>}
            <button type="submit" className="crm-button-primary" disabled={busy || Boolean(team?.invitationIssue)}>{reviewingInvite ? 'Send invite' : 'Review access'}</button></div>
        </form>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
    <Dialog.Root open={managingPresets} onOpenChange={(open) => {
      if (!open && !busy && confirmDiscard()) { setManagingPresets(false); setPresetDraft(null); setError(''); }
    }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
      <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
        <Dialog.Title className="text-lg font-bold">Permission presets</Dialog.Title>
        <Dialog.Description className="mb-4 text-sm text-cui-muted">Presets copy permissions into new invitations. Editing a preset does not change existing members.</Dialog.Description>
        {!presetDraft ? <div className="space-y-3">
          <button type="button" className="crm-button-primary" disabled={busy} onClick={() => setPresetDraft({ preset: null, name: '', grants: {}, active: true })}>Create preset</button>
          {team?.presets.length ? <ul className="divide-y divide-cui-border">{team.presets.map((preset) => <li key={preset.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <span>{preset.name} <span className="text-cui-muted">{preset.active ? 'Active' : 'Disabled'}</span></span>
            <button type="button" className="crm-button" disabled={busy} onClick={() => {
              setError(''); setPresetDraft({ preset, name: preset.name, grants: { ...preset.grants }, active: preset.active });
            }}>Edit {preset.name}</button>
          </li>)}</ul> : <p className="text-sm text-cui-muted">No presets yet. Create one to reuse a permission selection.</p>}
          {error && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
          <div className="flex justify-end"><Dialog.Close asChild><button type="button" className="crm-button" disabled={busy}>Close</button></Dialog.Close></div>
        </div> : <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          void run({ action: 'preset', id: presetDraft.preset?.id ?? null, version: presetDraft.preset?.version ?? null,
            name: presetDraft.name, grants: presetDraft.grants, active: presetDraft.active }, 'Preset saved.', () => setPresetDraft(null));
        }}>
          <label className="block text-sm font-bold">Preset name<input required maxLength={80} disabled={busy} className="crm-input mt-1"
            value={presetDraft.name} onChange={(event) => setPresetDraft({ ...presetDraft, name: event.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={busy}
            checked={presetDraft.active} onChange={(event) => setPresetDraft({ ...presetDraft, active: event.target.checked })} />Available for new invitations</label>
          <PermissionGrid heading="Preset permissions" disabled={busy} value={presetDraft.grants}
            onChange={(value) => setPresetDraft({ ...presetDraft, grants: value })} ceiling={team?.managerGrants} />
          {error && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className="crm-button" disabled={busy}
            onClick={() => { if (confirmDiscard()) { setPresetDraft(null); setError(''); } }}>Back</button>
            <button type="submit" className="crm-button-primary" disabled={busy}>Save preset</button></div>
        </form>}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
    <Dialog.Root open={Boolean(profile)} onOpenChange={(open) => {
      if (!open && !busy && confirmDiscard()) { setProfile(null); setError(''); }
    }}><Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
      <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,48rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
        <Dialog.Title className="text-lg font-bold">Member profile</Dialog.Title>
        <Dialog.Description className="mb-4 break-all text-sm text-cui-muted">{profile?.member.email}</Dialog.Description>
        {profile && <>
          <nav aria-label="Member profile sections" className="mb-4 flex flex-wrap gap-2">
            {profileSections.map((section) => <button key={section.id} type="button"
              aria-pressed={profileSection === section.id}
              className={profileSection === section.id ? 'crm-button-primary' : 'crm-button'}
              onClick={() => setProfileSection(section.id)}>{section.label}</button>)}
          </nav>
          {profileSection === 'profile' && <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            void run({ action: 'profile', user_id: profile.member.user_id, version: profile.member.access_version,
              full_name: profile.name, phone: profile.phone, address: profile.address }, 'Member profile updated.', () => setProfile(null));
          }}>
            <label className="block text-sm font-bold">Name<input required maxLength={120} disabled={busy} className="crm-input mt-1"
              value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
            <label className="block text-sm font-bold">Phone<input type="tel" maxLength={32} disabled={busy} className="crm-input mt-1"
              value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} /></label>
            <label className="block text-sm font-bold">Mailing address<input maxLength={300} disabled={busy} className="crm-input mt-1"
              value={profile.address} onChange={(event) => setProfile({ ...profile, address: event.target.value })} /></label>
            <p className="text-sm text-cui-muted">The member can request a verified sign-in email change in Account Security.</p>
            {error && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
            <div className="flex justify-end gap-2"><Dialog.Close asChild><button type="button" className="crm-button" disabled={busy}>Cancel</button></Dialog.Close>
              <button type="submit" className="crm-button-primary" disabled={busy}>Save profile</button></div>
          </form>}
          {profileSection === 'access' && <section aria-label="Member access" className="space-y-4">
            <h3 className="font-bold">{profile.member.role_title ?? 'Current permissions'}</h3>
            {profile.member.direct_grants && Object.keys(profile.member.direct_grants).length ? <ul className="grid gap-2 sm:grid-cols-2">
              {permissionKeys.filter((key) => profile.member.direct_grants?.[key]).map((key) => {
                const scope = profile.member.direct_grants?.[key];
                return <li key={key} className="rounded-xl border border-cui-border px-3 py-2 text-sm">
                  {TEAM_PROFILE_PERMISSIONS[key]} — {scope === 'agency' ? 'Agency-wide' : scope === 'assigned' ? 'Assigned only' : 'Own only'}
                </li>;
              })}
            </ul> : <p className="text-sm text-cui-muted">This member has no direct permissions recorded. Review their existing access before replacing it.</p>}
            <button type="button" className="crm-button" disabled={busy} onClick={() => {
              if (profileDirty && !confirmDiscard()) return;
              const { member } = profile;
              setProfile(null);
              setEditing({ member, title: member.role_title ?? '', grants: member.direct_grants ?? {}, active: member.active });
            }}>Edit access</button>
            <p className="text-sm text-cui-muted">Permanent removal is unavailable until linked records and retention requirements are checked. Deactivate access to preserve history.</p>
          </section>}
          {profileSection === 'security' && <section aria-label="Member security" className="space-y-3">
            <h3 className="font-bold">Account security</h3>
            <p className="text-sm text-cui-muted">Password resets send a secure link to the member. You cannot view or set their password.</p>
            {error && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
            {profile.member.active ? <button type="button" className="crm-button" disabled={busy} onClick={() => {
              if (window.confirm(`Send a password reset link to ${profile.member.email}?`)) {
                void run({ action: 'reset', user_id: profile.member.user_id }, 'Password reset email accepted by the provider. Delivery is not confirmed.');
              }
            }}>Send password reset</button> : <p className="text-sm text-cui-muted">Password reset is available when the member has active access.</p>}
          </section>}
          {profileSection === 'documents' && <section aria-label="Member documents" className="space-y-3">
            <h3 className="font-bold">Personnel documents</h3>
            <p className="text-sm text-cui-muted">Personnel files are separate from customer documents and require personnel-document authorization.</p>
            <Link className="crm-button" href={`/account?tab=documents&member=${encodeURIComponent(profile.member.user_id)}`}>Open personnel documents</Link>
          </section>}
          {profileSection === 'activity' && <section aria-label="Member activity" className="space-y-3">
            <h3 className="font-bold">Recent activity</h3>
            <p className="text-sm text-cui-muted">Showing matching entries from the 20 most recent Team events.</p>
            {(() => {
              const events = team?.activity.filter((item) => item.target_id === profile.member.user_id) ?? [];
              return events.length ? <ul className="divide-y divide-cui-border">{events.map((item) => <li className="py-2 text-sm" key={item.id}>
                <span className="font-semibold">{labels[item.action as keyof typeof labels] ?? item.action}</span>
                <time className="ml-2 text-cui-muted" dateTime={item.created_at}>{item.created_at.slice(0, 10)}</time>
              </li>)}</ul> : <p className="text-sm text-cui-muted">No matching events in the latest Team activity.</p>;
            })()}
          </section>}
        </>}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
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
            checked={editing.active} onChange={(event) => {
              const active = event.target.checked;
              if (!active && !window.confirm(`Deactivate ${editing.member.email}? Their CRM access will stop immediately; their history will remain.`)) return;
              setEditing({ ...editing, active });
            }} />Active access</label>}
          <PermissionGrid heading="Permissions" disabled={busy} value={editing.grants} onChange={(value) => setEditing({ ...editing, grants: value })} ceiling={team?.managerGrants} />
          {error && <p role="alert" className="text-sm">{error}</p>}
          <div className="flex justify-end gap-2"><Dialog.Close asChild><button type="button" className="crm-button" disabled={busy}>Cancel</button></Dialog.Close>
            <button type="submit" className="crm-button-primary" disabled={busy}>Save access</button></div>
        </form>}
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </section>;
}
