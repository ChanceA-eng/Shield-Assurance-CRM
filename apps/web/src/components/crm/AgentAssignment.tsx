'use client';
import { useEffect, useState } from 'react';
import type { RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';

export default function AgentAssignment({ target }: { target: RecordTarget }): JSX.Element | null {
  const [team, setTeam] = useState<{ member: { role: string }; members: Array<{ user_id: string; email: string; active: boolean }> } | null>(null);
  const [assigned, setAssigned] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void workspaceFetch<typeof team & { enabled?: boolean }>(`/api/agency/assignment?record_type=${target.type}&record_id=${target.id}`)
      .then((data) => { if (active && data) { setTeam(data); setAssigned('agent_user_id' in data && typeof data.agent_user_id === 'string' ? data.agent_user_id : ''); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Assignment unavailable.'); });
    return () => { active = false; };
  }, [target.id, target.type]);
  if (!team) return error ? <p className="text-xs text-cui-danger">{error}</p> : null;
  return <label className="block text-xs font-semibold text-cui-muted">Assigned agent
    <select value={assigned} disabled={busy || team.member.role === 'agent'} className="ml-2 rounded border border-cui-border p-1.5 text-sm" onChange={(event) => {
      const userId = event.target.value; setBusy(true); setError('');
      void workspaceFetch('/api/agency', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'assign', record_type: target.type, record_id: target.id, user_id: userId || null }) })
        .then(() => setAssigned(userId)).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Assignment was not saved.'))
        .finally(() => setBusy(false));
    }}><option value="">Unassigned / legacy text retained</option>{team.members.filter((member) => member.active || member.user_id === assigned).map((member) => <option key={member.user_id} value={member.user_id}>{member.email}{member.active ? '' : ' (inactive)'}</option>)}</select>
    {error ? <span role="alert" className="block text-cui-danger">{error}</span> : null}
  </label>;
}
