'use client';

import { useEffect, useState } from 'react';
import type { RecordTarget } from '@crm/shared';
import SalesSequences from './SalesSequences';
import { workspaceFetch } from '../../lib/workspace-fetch';
import ConversationTool from './ConversationTool';

export default function ConversationSequences({ target }: { target: RecordTarget }): JSX.Element {
  const [leads, setLeads] = useState<Array<{ id: string; full_name: string }>>([]);
  const [selected, setSelected] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    if (target.type !== 'client') return;
    let active = true;
    void workspaceFetch<Array<{ id: string; full_name: string }>>(`/api/leads?account_id=${encodeURIComponent(target.id)}&status=open`)
      .then((rows) => { if (active) { setLeads(rows); setSelected(rows.length === 1 ? rows[0].id : ''); setError(''); } })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Linked follow-ups could not be loaded.'); });
    return () => { active = false; };
  }, [target.type, target.id]);
  if (target.type === 'lead') return <SalesSequences leadId={target.id} />;
  return <ConversationTool label="Sequences" title="Follow-up sequences" large><div className="space-y-2">
    {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
    {leads.length > 1 ? <label className="block text-xs font-semibold">Follow-up lead
      <select value={selected} onChange={(event) => setSelected(event.target.value)} className="mt-1 w-full rounded border border-cui-border p-2 text-sm">
        <option value="">Choose a linked lead</option>
        {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.full_name}</option>)}
      </select>
    </label> : null}
    {selected ? <SalesSequences key={selected} leadId={selected} embedded /> : !error && !leads.length ? <p className="text-xs text-cui-muted">Follow-up sequences are available on open leads linked to this account.</p> : null}
  </div></ConversationTool>;
}
