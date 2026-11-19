'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { UserPlus, X } from 'lucide-react';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import { workspaceFetch } from '../../lib/workspace-fetch';

interface AttentionLead {
  intake_id: string;
  id: string;
  full_name: string;
  line_of_business: string | null;
  business_name: string | null;
  industry: string | null;
  arrived_at: string;
  time_basis: 'submitted' | 'received';
  request_kind: string;
}

export const INTAKE_QUEUE_CHANGED = 'crm:intake-queue-changed';

export default function NewLeadBanner(): JSX.Element | null {
  const [leads, setLeads] = useState<AttentionLead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const loadVersion = useRef(0);
  const loading = useRef<Promise<void> | null>(null);
  const refreshFailures = useRef(0);

  const load = useCallback(async (force = false): Promise<void> => {
    if (loading.current && !force) return loading.current;
    const version = ++loadVersion.current;
    const pending = (async () => { try {
      const payload = await workspaceFetch<{ leads: AttentionLead[] }>('/api/leads/attention');
      if (version !== loadVersion.current) return;
      setLeads(payload.leads);
      refreshFailures.current = 0;
      setError(null);
    } catch (failure) {
      if (version === loadVersion.current) {
        console.error('[website-requests/refresh]', failure);
        refreshFailures.current += 1;
        if (refreshFailures.current >= 2) setError('New requests could not refresh.');
      }
    } })();
    loading.current = pending;
    try { await pending; } finally { if (loading.current === pending) loading.current = null; }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void load(); }, 30000);
    const refresh = (): void => { void load(true); };
    const onVisible = (): void => { if (document.visibilityState !== 'hidden') void load(); };
    window.addEventListener(INTAKE_QUEUE_CHANGED, refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(INTAKE_QUEUE_CHANGED, refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const dismiss = async (id: string): Promise<void> => {
    setBusyId(id);
    setActionError(null);
    try {
      await workspaceFetch('/api/leads/attention', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'dismissed' }),
      });
      ++loadVersion.current;
      setLeads((current) => current.filter((lead) => lead.intake_id !== id));
      void load();
    } catch (failure) {
      console.error('[website-requests/dismiss]', failure);
      setActionError('This request could not be dismissed. Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  if (!leads.length && !error && !actionError) return null;
  return (
    <section aria-label="Unreviewed website requests" className="max-h-[calc(100dvh-4rem)] shrink-0 overflow-y-auto border-b border-orange-300 bg-orange-100">
      {error ? (
        <div role="alert" className="flex items-center justify-between gap-2 px-4 py-2 text-sm text-orange-950">
          <span>{error}</span>
          <button type="button" onClick={() => void load()} className="font-semibold text-cui-primary hover:underline">Retry</button>
        </div>
      ) : null}
      {actionError ? <p role="alert" className="px-4 py-2 text-sm text-orange-950">{actionError}</p> : null}
      {leads.length ? <p className="px-4 pt-1 text-[11px] font-semibold text-orange-900">{leads.length} unreviewed request{leads.length === 1 ? '' : 's'} - newest first</p> : null}
      {leads.map((lead) => (
        <div key={lead.intake_id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-orange-300 px-4 py-1.5 text-sm last:border-b-0">
          <UserPlus className="h-4 w-4 shrink-0 text-orange-700" />
          <p className="min-w-0 flex-1 break-words text-cui-text">
            <span className="font-bold text-orange-900">{lead.request_kind}:</span>{' '}
            <Link href={`/leads?lead=${lead.id}` as Route} className="font-semibold text-cui-primary hover:underline">{lead.full_name}</Link>
            {lead.business_name ? <span> - {lead.business_name}</span> : null}
            {[lead.line_of_business, lead.industry].filter(Boolean).length ? (
              <span className="text-orange-900/80"> | {[lead.line_of_business, lead.industry].filter(Boolean).join(' / ')}</span>
            ) : null}
            <span className="ml-2 text-xs text-orange-900/80 sm:whitespace-nowrap">
              {lead.time_basis === 'submitted' ? 'Submitted' : 'Received'} {formatArizonaDateTime(lead.arrived_at)} AZ
            </span>
          </p>
          <Link href={`/leads?lead=${lead.id}` as Route} className="shrink-0 rounded bg-cui-primary px-2.5 py-0.5 text-xs font-semibold text-white hover:brightness-95">
            Open profile
          </Link>
          <button type="button" onClick={() => void dismiss(lead.intake_id)} disabled={busyId === lead.intake_id}
            className="shrink-0 rounded p-0.5 text-orange-700 hover:text-orange-950 disabled:opacity-50"
            aria-label={`Dismiss request from ${lead.full_name}`}>
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </section>
  );
}
