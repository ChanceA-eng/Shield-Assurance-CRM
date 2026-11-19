'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { isTeamScope, parseTeamExceptions, parseTeamGrants, resolveTeamAccess, TEAM_PERMISSIONS, validateTeamAccess, type TeamPermission } from '@crm/shared';
import type { ManagedTeamMember, ManagedTeamRole, TeamManagementData } from '../../lib/team-management';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';
import { Card, CardBody, CardHeader } from '../ui/Card';

const endpoint = '/api/agency?access=true';
const groups = Object.entries(TEAM_PERMISSIONS).reduce<Record<string, TeamPermission[]>>((result, [key, permission]) => {
  (result[permission.group] ??= []).push(key as TeamPermission);
  return result;
}, {});

type Editor = { kind: 'invite'; id: string } | { kind: 'member'; member: ManagedTeamMember }
  | { kind: 'role'; id: string; role?: ManagedTeamRole };

export default function TeamAccessWorkspace({ initial }: { initial: TeamManagementData }): JSX.Element {
  const [team, setTeam] = useState(initial);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const { confirmDiscard, markSaved } = useUnsavedChanges(dirty);
  const roles = new Map(team.roles.map((role) => [role.id, role]));
  const currentRole = roles.get(roleId);
  const workingOnRole = editor?.kind === 'role';
  const exceptions = Object.fromEntries(Object.entries(choices).flatMap(([permission, choice]) => choice === 'deny'
    ? [[permission, { effect: 'deny' }]] : isTeamScope(choice) ? [[permission, { effect: 'allow', scope: choice }]] : []));
  const grants = Object.fromEntries(Object.entries(choices).filter(([, choice]) => isTeamScope(choice)));
  const effective = currentRole ? { ...currentRole.grants } : {};
  for (const [permission, choice] of Object.entries(choices)) {
    const key = permission as TeamPermission;
    if (choice === 'deny') delete effective[key];
    else if (isTeamScope(choice)) effective[key] = choice;
  }

  const open = (next: Editor): void => {
    setError(''); setNotice(''); setDirty(false); setEditor(next);
    setName(next.kind === 'role' ? next.role?.name ?? '' : '');
    setRoleId(next.kind === 'member' ? next.member.team_role_id ?? '' : '');
    setActive(next.kind !== 'member' || next.member.active);
    setChoices(next.kind === 'role' ? { ...next.role?.grants } : next.kind === 'member'
      ? Object.fromEntries(parseTeamExceptions(next.member.access_exceptions).map((item) => [item.permission, item.effect === 'deny' ? 'deny' : item.scope]))
      : {});
  };
  const submit = async (command: object, message: string): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
      markSaved(); setDirty(false); setEditor(null); setNotice(message);
      setTeam(await workspaceFetch<TeamManagementData>(endpoint));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Team changes could not be saved.');
    } finally { setBusy(false); }
  };
  const save = (): void => {
    if (!editor) return;
    try {
      if (editor.kind === 'role') {
        parseTeamGrants(grants);
        void submit({ action: 'save_role', role_id: editor.id, name, grants, version: editor.role?.version ?? null }, 'Role saved.');
      } else {
        if (!currentRole) throw new Error('Choose a role.');
        validateTeamAccess(resolveTeamAccess(parseTeamGrants(currentRole.grants), parseTeamExceptions(exceptions)));
        if (editor.kind === 'invite') {
          void submit({ action: 'invite', id: editor.id, email: name, role_id: roleId, role_version: currentRole.version, exceptions }, 'Invitation sent.');
        } else {
          if (!active && editor.member.active && !window.confirm(`Suspend access for ${editor.member.email}?`)) return;
          void submit({ action: 'edit_access', user_id: editor.member.user_id, role_id: roleId, version: editor.member.access_version, exceptions, active }, 'Member access saved.');
        }
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Review the selected permissions.'); }
  };
  const pendingIds = new Set(team.invitations.map(({ id }) => id));
  const title = editor?.kind === 'invite' ? 'Invite member' : editor?.kind === 'member' ? 'Edit member access' : editor?.role ? 'Edit role' : 'New role';
  return <div className="space-y-4">
    {notice && <p role="status">{notice}</p>}
    {error && !editor && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
    <Card>
      <CardHeader actions={<button type="button" className="crm-button-primary" disabled={busy} onClick={() => open({ kind: 'invite', id: crypto.randomUUID() })}>Invite member</button>}>Team</CardHeader>
      <CardBody>
        <ul className="divide-y divide-cui-border">
          {team.members.filter((member) => !member.invitation_id || !pendingIds.has(member.invitation_id)).map((member) => (
            <li key={member.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div><p className="font-semibold">{member.email}</p><p className="text-cui-muted">
                {member.role === 'owner' ? 'Owner' : roles.get(member.team_role_id ?? '')?.name ?? 'No role'} · {member.active ? 'Active' : 'Suspended'}
              </p></div>
              {member.role !== 'owner' && <button className="crm-button" type="button" disabled={busy} onClick={() => open({ kind: 'member', member })}>Edit access</button>}
            </li>
          ))}
          {team.invitations.map((invite) => <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div><p className="font-semibold">{invite.email}</p><p className="text-cui-muted">{roles.get(invite.role_id)?.name ?? 'No role'} · {invite.state === 'sent' ? 'Invited' : invite.state === 'delivery_failed' ? 'Delivery failed' : 'Pending'}</p>
            {invite.delivery_error && <p className="text-cui-muted">{invite.delivery_error}</p>}</div>
            <button type="button" className="crm-button" disabled={busy} onClick={() => {
              if (window.confirm(`Revoke the invitation for ${invite.email}?`)) void submit({ action: 'revoke_invitation', id: invite.id, version: invite.version }, 'Invitation revoked.');
            }}>Revoke invitation</button>
          </li>)}
        </ul>
      </CardBody>
    </Card>
    <Card>
      <CardHeader actions={<button type="button" className="crm-button" disabled={busy} onClick={() => open({ kind: 'role', id: `role-${crypto.randomUUID()}` })}>New role</button>}>Roles</CardHeader>
      <CardBody><ul className="divide-y divide-cui-border">{team.roles.map((role) => <li key={role.id} className="flex items-center justify-between gap-3 py-3 text-sm">
        <span className="font-semibold">{role.name}</span>
        <button type="button" aria-label={`Edit ${role.name} role`} className="crm-button" disabled={busy} onClick={() => open({ kind: 'role', id: role.id, role })}>Edit role</button>
      </li>)}</ul></CardBody>
    </Card>
    <Dialog.Root open={Boolean(editor)} onOpenChange={(visible) => {
      if (!visible && !busy && confirmDiscard()) { setEditor(null); setDirty(false); setError(''); }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/60" />
        <Dialog.Content className="crm-shell fixed left-1/2 top-1/2 z-[101] max-h-[90dvh] w-[min(94vw,42rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-cui-border bg-cui-panel p-5 text-cui-text shadow-panel">
          <Dialog.Title className="text-lg font-bold">{title}</Dialog.Title>
          <Dialog.Description className="mb-4 text-sm text-cui-muted">{editor?.kind === 'member' ? editor.member.email : workingOnRole ? 'Choose the default permissions for this role.' : 'Choose what this member can access.'}</Dialog.Description>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
            {editor?.kind !== 'member' && <label className="block text-sm font-semibold">{workingOnRole ? 'Role name' : 'Member email'}
              <input className="crm-input mt-1" required type={workingOnRole ? 'text' : 'email'} maxLength={workingOnRole ? 80 : 254} value={name} onChange={(event) => { setName(event.target.value); setDirty(true); }} />
            </label>}
            {!workingOnRole && <label className="block text-sm font-semibold">Role
              <select className="crm-input mt-1" required value={roleId} onChange={(event) => { setRoleId(event.target.value); setDirty(true); }}>
                <option value="">Choose a role</option>{team.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>}
            {editor?.kind === 'member' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(event) => { setActive(event.target.checked); setDirty(true); }} />Active access</label>}
            {(workingOnRole || currentRole) && <div className="space-y-2">
              {!workingOnRole && <p className="text-sm font-semibold">Permission overrides</p>}
              {Object.entries(groups).map(([group, permissions]) => <details key={group} className="rounded border border-cui-border p-3">
                <summary className="cursor-pointer text-sm font-semibold">{group} ({permissions.filter((key) => workingOnRole ? grants[key] : effective[key]).length})</summary>
                <div className="mt-2 space-y-2">{permissions.map((key) => <label key={key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{TEAM_PERMISSIONS[key].label}</span>
                  <select className="crm-input w-auto" value={choices[key] ?? ''} onChange={(event) => {
                    setChoices((current) => ({ ...current, [key]: event.target.value })); setDirty(true);
                  }}>
                    <option value="">{workingOnRole ? 'No access' : `Use role (${currentRole?.grants[key] ?? 'no access'})`}</option>
                    {!workingOnRole && <option value="deny">Deny</option>}
                    {TEAM_PERMISSIONS[key].scopes.map((scope) => <option key={scope} value={scope}>{scope === 'agency' ? 'Agency-wide' : scope === 'assigned' ? 'Assigned only' : 'Own only'}</option>)}
                  </select>
                </label>)}</div>
              </details>)}
            </div>}
            {error && <p role="alert" className="text-sm text-cui-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Dialog.Close asChild><button type="button" className="crm-button" disabled={busy}>Cancel</button></Dialog.Close>
              <button type="submit" className="crm-button-primary" disabled={busy}>{busy ? 'Saving...' : editor?.kind === 'invite' ? 'Send invitation' : 'Save changes'}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
