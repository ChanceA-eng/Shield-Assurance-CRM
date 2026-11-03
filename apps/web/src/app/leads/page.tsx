'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import SectionLayout from '../../components/crm/SectionLayout';
import NewLeadModal from './NewLeadModal';
import PipelineBoard from './PipelineBoard';
import LeadWorkspace from './LeadWorkspace';
import { LEAD_STATUS_LABELS, type LeadStatus, type LostReason } from '../../lib/lead-pipeline';

interface Lead {
  id: string;
  full_name: string;
  industry?: string | null;
  category?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source: string;
  line_of_business: string;
  status: string;
  created_at: string;
  website?: string | null;
  est_employees?: string | null;
  est_revenue?: string | null;
  risk_exposure?: string | null;
  estimated_premium?: number | string | null;
  stage_changed_at?: string | null;
  lost_reason?: string | null;
  form_payload?: Record<string, unknown> | null;
  last_viewed_at?: string | null;
  last_activity_at?: string | null;
}

interface NewLeadForm {
  full_name: string;
  phone: string;
  email: string;
  line_of_business: string;
  source: string;
  status: 'new';
}

type PipelineFilter = 'all' | 'prospects' | 'leads';

type ListSortKey = 'name' | 'status' | 'premium' | 'followup' | 'created';

const STATUS_PILL_TONES: Record<string, string> = {
  new: 'bg-[#63c2de]/20 text-[#167495]',
  contacted: 'bg-[#20a8d8]/15 text-[#167495]',
  quoted: 'bg-[#ffc107]/25 text-amber-800',
  won: 'bg-[#4dbd74]/20 text-green-700',
  lost: 'bg-[#f86c6b]/15 text-[#f86c6b]',
  inactive: 'bg-[#f0f3f5] text-[#73818f]',
};

function premiumOf(lead: { estimated_premium?: number | string | null }): number {
  const raw = lead.estimated_premium;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (typeof raw === 'string') {
    const parsed = Number(raw.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Displays US phone numbers as (xxx) xxx-xxxx regardless of stored format. */
function formatPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  const core = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (core.length !== 10) return value;
  return `(${core.slice(0, 3)}) ${core.slice(3, 6)}-${core.slice(6)}`;
}

interface LeadTaskRow {
  id: string;
  subject: string;
  due_date: string | null;
  status: string;
  related_id: string | null;
}

export default function LeadsPage(): JSX.Element {
  // useSearchParams requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={null}>
      <LeadsPageInner />
    </Suspense>
  );
}

function LeadsPageInner(): JSX.Element {
  const searchParams = useSearchParams();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewLead, setShowNewLead] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>('all');
  const [viewMode, setViewMode] = useState<'queue' | 'board' | 'list'>('board');
  const [outcomeFilter, setOutcomeFilter] = useState<'active' | 'won' | 'lost' | 'inactive'>('active');
  const outcomeRef = React.useRef<'active' | 'won' | 'lost' | 'inactive'>('active');
  outcomeRef.current = outcomeFilter;
  const [stats, setStats] = useState<{ active: number; won: number; lost: number; inactive: number }>({ active: 0, won: 0, lost: 0, inactive: 0 });
  const [listSearch, setListSearch] = useState('');
  const [listSort, setListSort] = useState<{ key: ListSortKey; dir: 'asc' | 'desc' }>({ key: 'created', dir: 'desc' });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkFollowUpAt, setBulkFollowUpAt] = useState('');
  const [leadTasks, setLeadTasks] = useState<LeadTaskRow[]>([]);
  const [unreadByLead, setUnreadByLead] = useState<Record<string, number>>({});
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [pendingLeadId, setPendingLeadId] = useState<string | null>(null);
  const [newLead, setNewLead] = useState<NewLeadForm>({
    full_name: '',
    phone: '',
    email: '',
    line_of_business: '',
    source: '',
    status: 'new',
  });

  const isProspect = (lead: Lead): boolean => {
    const source = lead.source?.toLowerCase() ?? '';
    return source.includes('prospect');
  };

  const filteredLeads = leads.filter((lead) => {
    if (pipelineFilter === 'prospects') {
      return isProspect(lead);
    }

    if (pipelineFilter === 'leads') {
      return !isProspect(lead);
    }

    return true;
  });

  const prospectCount = leads.filter((lead) => isProspect(lead)).length;
  const leadCount = leads.length - prospectCount;

  const fetchLeadTasks = async (): Promise<void> => {
    try {
      const [tasksRes, unreadRes, statsRes] = await Promise.all([
        fetch('/api/tasks?status=open&related_type=lead&sort=due_asc&limit=200', { cache: 'no-store' }),
        fetch('/api/communication-log/unread-by-lead', { cache: 'no-store' }),
        fetch('/api/leads/stats', { cache: 'no-store' }),
      ]);
      setLeadTasks(tasksRes.ok ? ((await tasksRes.json()) as LeadTaskRow[]) : []);
      setUnreadByLead(unreadRes.ok ? ((await unreadRes.json()) as Record<string, number>) : {});
      if (statsRes.ok) {
        setStats((await statsRes.json()) as { active: number; won: number; lost: number; inactive: number });
      }
    } catch {
      setLeadTasks([]);
      setUnreadByLead({});
    }
  };

  // lead_id -> earliest open task due date (board chips)
  const taskDueByLead = useMemo(() => {
    const map: Record<string, string> = {};
    for (const task of leadTasks) {
      if (!task.related_id || !task.due_date) continue;
      if (!map[task.related_id] || task.due_date < map[task.related_id]) {
        map[task.related_id] = task.due_date;
      }
    }
    return map;
  }, [leadTasks]);

  const leadById = useMemo(() => new Map(leads.map((lead) => [lead.id, lead])), [leads]);

  // Work queue: open lead tasks due today or overdue, worst first.
  // Scoped to currently-loaded active leads so stale or foreign tasks never clutter the queue.
  const queueTasks = useMemo(() => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    return leadTasks
      .filter(
        (task) =>
          task.due_date &&
          task.related_id &&
          leadById.has(task.related_id) &&
          new Date(task.due_date).getTime() <= endOfToday.getTime(),
      )
      .sort((a, b) => new Date(a.due_date ?? 0).getTime() - new Date(b.due_date ?? 0).getTime());
  }, [leadTasks, leadById]);

  // List view: search + sort over the pipeline-filtered leads.
  const listLeads = useMemo(() => {
    const query = listSearch.trim().toLowerCase();
    const matched = query
      ? filteredLeads.filter((lead) =>
          [lead.full_name, lead.email, lead.phone, lead.line_of_business, lead.source, lead.status]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query)),
        )
      : filteredLeads;

    const dir = listSort.dir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      switch (listSort.key) {
        case 'name':
          return a.full_name.localeCompare(b.full_name) * dir;
        case 'status':
          return a.status.localeCompare(b.status) * dir;
        case 'premium':
          return (premiumOf(a) - premiumOf(b)) * dir;
        case 'followup': {
          const aDue = taskDueByLead[a.id] ?? '9999';
          const bDue = taskDueByLead[b.id] ?? '9999';
          return aDue.localeCompare(bDue) * dir;
        }
        default:
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
      }
    });
  }, [filteredLeads, listSearch, listSort, taskDueByLead]);

  const toggleListSort = (key: ListSortKey): void => {
    setListSort((current) =>
      current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  };

  const toggleSelected = (leadId: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) {
        next.delete(leadId);
      } else {
        next.add(leadId);
      }
      return next;
    });
  };

  const allVisibleSelected = listLeads.length > 0 && listLeads.every((lead) => selectedIds.has(lead.id));

  const toggleSelectAll = (): void => {
    setSelectedIds(allVisibleSelected ? new Set() : new Set(listLeads.map((lead) => lead.id)));
  };

  const selectedLeads = listLeads.filter((lead) => selectedIds.has(lead.id));
  const selectedPremium = selectedLeads.reduce((sum, lead) => sum + premiumOf(lead), 0);

  const runBulk = async (operation: (leadId: string) => Promise<Response>): Promise<void> => {
    setBulkBusy(true);
    setError(null);
    try {
      const results = await Promise.allSettled([...selectedIds].map((leadId) => operation(leadId)));
      const failures = results.filter(
        (result) => result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.ok),
      ).length;
      if (failures > 0) {
        setError(`${failures} of ${results.length} bulk updates failed.`);
      }
      setSelectedIds(new Set());
      await Promise.all([fetchLeads(false), fetchLeadTasks()]);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkSetStatus = async (status: string): Promise<void> => {
    if (!status) return;
    await runBulk((leadId) =>
      fetch(`/api/leads/${encodeURIComponent(leadId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(status === 'lost' ? { status, lost_reason: 'other' } : { status }),
      }),
    );
  };

  const bulkDelete = async (): Promise<void> => {
    const confirmed = window.confirm(`Remove ${selectedIds.size} selected lead(s)? This cannot be undone.`);
    if (!confirmed) return;
    await runBulk((leadId) =>
      fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId }),
      }),
    );
  };

  const bulkScheduleFollowUp = async (): Promise<void> => {
    if (!bulkFollowUpAt) return;
    const dueIso = new Date(bulkFollowUpAt).toISOString();
    await runBulk((leadId) => {
      const lead = leadById.get(leadId);
      return fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: `Follow up with ${lead?.full_name ?? 'lead'}`,
          due_date: dueIso,
          related_type: 'lead',
          related_id: leadId,
        }),
      });
    });
    setBulkFollowUpAt('');
  };

  const completeQueueTask = async (task: LeadTaskRow, advance: boolean): Promise<void> => {
    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, status: 'completed' }),
    });
    if (!res.ok) {
      setError('Failed to complete task.');
      return;
    }
    await fetchLeadTasks();
    if (advance) {
      const next = queueTasks.find((candidate) => candidate.id !== task.id && candidate.related_id);
      const nextLead = next?.related_id ? leadById.get(next.related_id) : null;
      setSelectedLead(nextLead ?? null);
    }
  };

  const snoozeQueueTask = async (task: LeadTaskRow, option: 'later' | 'tomorrow' | 'nextweek'): Promise<void> => {
    const due = new Date();
    if (option === 'later') {
      due.setHours(due.getHours() + 4);
    } else if (option === 'tomorrow') {
      due.setDate(due.getDate() + 1);
      due.setHours(9, 0, 0, 0);
    } else {
      due.setDate(due.getDate() + 7);
      due.setHours(9, 0, 0, 0);
    }

    const res = await fetch('/api/tasks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: task.id, due_date: due.toISOString() }),
    });
    if (!res.ok) {
      setError('Failed to snooze task.');
      return;
    }
    await fetchLeadTasks();
  };

  const fetchLeads = async (showLoader = true): Promise<void> => {
    if (showLoader) {
      setLoading(true);
    }
    setError(null);

    try {
      const statusParam = outcomeRef.current === 'active' ? 'open' : outcomeRef.current;
      const res = await fetch(`/api/leads?owner=me&status=${statusParam}`, { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to load leads.');
        return;
      }

      const data = (await res.json()) as Lead[];
      setLeads(data);
    } catch {
      setError('Network error while loading leads. Please try again.');
    } finally {
      if (showLoader) {
        setLoading(false);
      }
    }
  };

  const handlePipelineStatusChange = async (
    leadId: string,
    status: LeadStatus,
    lostReason?: LostReason,
  ): Promise<void> => {
    // Optimistic: move the card immediately, roll back on failure.
    const previous = leads;
    setLeads((current) =>
      current.map((lead) =>
        lead.id === leadId ? { ...lead, status, stage_changed_at: new Date().toISOString() } : lead,
      ),
    );

    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lostReason ? { status, lost_reason: lostReason } : { status }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => ({ message: 'Failed to update lead stage.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to update lead stage.');
        setLeads(previous);
        return;
      }

      // Terminal statuses drop out of the open-leads query on next refresh.
      await fetchLeads(false);
    } catch {
      setError('Network error while updating lead stage.');
      setLeads(previous);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    if (view === 'queue' || view === 'board' || view === 'list') {
      setViewMode(view);
    }

    void (async () => {
      await Promise.all([fetchLeads(true), fetchLeadTasks()]);
    })();

    const refreshInterval = window.setInterval(() => {
      void fetchLeads(false);
      void fetchLeadTasks();
    }, 30000);

    const refreshOnFocus = (): void => {
      void fetchLeads(false);
    };

    window.addEventListener('focus', refreshOnFocus);

    return () => {
      window.clearInterval(refreshInterval);
      window.removeEventListener('focus', refreshOnFocus);
    };
  }, []);

  // Refetch when switching between active pipeline and terminal outcomes.
  useEffect(() => {
    void fetchLeads(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeFilter]);

  // Reacts to ?lead=<id> both on first load and on in-page navigations
  // (e.g. clicking the new-lead banner while already on this page).
  useEffect(() => {
    const leadParam = searchParams.get('lead');
    if (leadParam) setPendingLeadId(leadParam);
  }, [searchParams]);

  // Once handled, strip the param so clicking the same lead again retriggers.
  const clearLeadParam = (): void => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lead')) {
      url.searchParams.delete('lead');
      window.history.replaceState(null, '', url.toString());
    }
  };

  // Deep link: /leads?lead=<id> opens the workspace drawer once leads load.
  useEffect(() => {
    if (!pendingLeadId) return;
    const target = leads.find((lead) => lead.id === pendingLeadId);
    if (target) {
      setSelectedLead(target);
      setPendingLeadId(null);
      clearLeadParam();
      return;
    }
    if (loading) return;
    // Not in the active list (won/lost/inactive or filtered out) — fetch it directly.
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(pendingLeadId)}`, { cache: 'no-store' });
        if (res.ok && !cancelled) {
          setSelectedLead((await res.json()) as Lead);
        }
      } catch {
        // Lead no longer exists; nothing to open.
      } finally {
        if (!cancelled) {
          setPendingLeadId(null);
          clearLeadParam();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingLeadId, leads, loading]);

  const handleCreateLead = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setIsCreating(true);
    setError(null);

    const res = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newLead),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to create lead.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create lead.');
      setIsCreating(false);
      return;
    }

    setShowNewLead(false);
    setNewLead({
      full_name: '',
      phone: '',
      email: '',
      line_of_business: '',
      source: '',
      status: 'new',
    });
    setIsCreating(false);
    await fetchLeads();
  };

  const handleUpdateLead = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!editingLead) return;
    setIsSavingEdit(true);
    setError(null);

    const res = await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editingLead),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to update lead.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to update lead.');
      setIsSavingEdit(false);
      return;
    }

    setIsSavingEdit(false);
    setEditingLead(null);
    await fetchLeads();
  };

  const handleRemoveLead = async (id: string): Promise<void> => {
    const confirmed = window.confirm('Remove this lead? This action cannot be undone.');
    if (!confirmed) return;

    const res = await fetch('/api/leads', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });

    if (!res.ok) {
      const payload = (await res.json().catch(() => ({ message: 'Failed to remove lead.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to remove lead.');
      return;
    }

    await fetchLeads();
  };

  return (
    <SectionLayout title="Leads">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#5c6873]">Manage open insurance leads and new requests.</p>
        <div className="flex items-center gap-2">
          <Link
            href="/leads/import"
            className="rounded border border-[#a8d4ff] bg-[#f5fbff] px-3 py-2 text-xs font-semibold text-[#167495] transition hover:bg-[#e7f3ff]"
          >
            Import Center
          </Link>

          <button
            type="button"
            onClick={() => setShowNewLead(true)}
            className="rounded border border-[#1b8eb7] bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7]"
          >
            + New Lead
          </button>
        </div>
      </div>

      <div className="mb-4 flex items-center gap-2 text-xs">
        <button
          type="button"
          onClick={() => setPipelineFilter('all')}
          className={`rounded border px-3 py-1.5 font-semibold ${
            pipelineFilter === 'all' ? 'border-[#167495] bg-[#167495] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
          }`}
        >
          {outcomeFilter === 'active' ? `All Active (${leads.length})` : `All ${outcomeFilter} (${leads.length})`}
        </button>
        <button
          type="button"
          onClick={() => setPipelineFilter('prospects')}
          className={`rounded border px-3 py-1.5 font-semibold ${
            pipelineFilter === 'prospects' ? 'border-[#167495] bg-[#167495] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
          }`}
        >
          Prospects ({prospectCount})
        </button>
        <button
          type="button"
          onClick={() => setPipelineFilter('leads')}
          className={`rounded border px-3 py-1.5 font-semibold ${
            pipelineFilter === 'leads' ? 'border-[#167495] bg-[#167495] text-white' : 'border-[#d5dde5] bg-white text-[#28557f]'
          }`}
        >
          Leads ({leadCount})
        </button>

        <span className="mx-1 h-5 w-px bg-[#d5dde5]" />

        {(
          [
            ['won', 'Won', stats.won, 'text-green-700 border-[#4dbd74]/50', 'bg-[#4dbd74] text-white border-[#4dbd74]'],
            ['lost', 'Lost', stats.lost, 'text-[#f86c6b] border-[#f86c6b]/50', 'bg-[#f86c6b] text-white border-[#f86c6b]'],
            ['inactive', 'Inactive', stats.inactive, 'text-[#73818f] border-[#c8ced3]', 'bg-[#73818f] text-white border-[#73818f]'],
          ] as Array<['won' | 'lost' | 'inactive', string, number, string, string]>
        ).map(([key, label, count, idle, selected]) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              if (outcomeFilter === key) {
                setOutcomeFilter('active');
              } else {
                setOutcomeFilter(key);
                setViewMode('list');
              }
            }}
            className={`rounded border bg-white px-3 py-1.5 font-semibold ${outcomeFilter === key ? selected : idle}`}
            title={`View ${label.toLowerCase()} leads`}
          >
            {label} ({count})
          </button>
        ))}

        <div className="ml-auto flex items-center overflow-hidden rounded border border-[#d5dde5]">
          <button
            type="button"
            onClick={() => {
              setOutcomeFilter('active');
              setViewMode('queue');
            }}
            className={`px-3 py-1.5 font-semibold ${viewMode === 'queue' ? 'bg-[#167495] text-white' : 'bg-white text-[#28557f]'}`}
          >
            Queue ({queueTasks.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setOutcomeFilter('active');
              setViewMode('board');
            }}
            className={`px-3 py-1.5 font-semibold ${viewMode === 'board' ? 'bg-[#167495] text-white' : 'bg-white text-[#28557f]'}`}
          >
            Board
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 font-semibold ${viewMode === 'list' ? 'bg-[#167495] text-white' : 'bg-white text-[#28557f]'}`}
          >
            List
          </button>
        </div>
      </div>

      {outcomeFilter !== 'active' ? (
        <div className="mb-3 flex items-center gap-2 rounded border border-[#c8ced3] bg-[#f0f3f5] px-3 py-2 text-sm text-[#5c6873]">
          Viewing <span className="font-bold uppercase">{outcomeFilter}</span> leads.
          <button type="button" onClick={() => setOutcomeFilter('active')} className="font-semibold text-[#167495] hover:underline">
            Back to active pipeline
          </button>
        </div>
      ) : null}

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {loading ? <div className="text-sm text-[#73818f]">Loading leads...</div> : null}

      {!loading && viewMode === 'queue' ? (
        <div className="rounded border border-[#c8ced3] bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-[#f0f3f5] bg-[#f8f9fa] px-4 py-2.5">
            <p className="text-sm font-bold text-[#23282c]">
              Work Queue <span className="font-normal text-[#73818f]">— follow-ups due today or overdue</span>
            </p>
            <p className="text-xs font-semibold text-[#73818f]">{queueTasks.length} to work</p>
          </div>
          {queueTasks.length === 0 ? (
            <p className="p-6 text-center text-sm text-[#73818f]">Queue is clear. Nothing due today — nice work.</p>
          ) : (
            <ul className="divide-y divide-[#f0f3f5]">
              {queueTasks.map((task) => {
                const lead = task.related_id ? leadById.get(task.related_id) : undefined;
                const due = task.due_date ? new Date(task.due_date) : null;
                const overdue = due ? due.getTime() < Date.now() : false;
                return (
                  <li key={task.id} className="flex items-center gap-3 px-4 py-3">
                    <span
                      className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                        overdue ? 'bg-[#f86c6b] text-white' : 'bg-[#ffc107]/25 text-amber-800'
                      }`}
                    >
                      {overdue ? 'Overdue' : 'Today'}
                    </span>
                    <button
                      type="button"
                      onClick={() => lead && setSelectedLead(lead)}
                      disabled={!lead}
                      className="min-w-0 flex-1 text-left disabled:cursor-default"
                    >
                      <p className="truncate text-sm font-semibold text-[#167495] hover:underline">
                        {lead?.full_name ?? 'Unknown lead'}
                      </p>
                      <p className="truncate text-xs text-[#73818f]">{task.subject}</p>
                    </button>
                    <span className="shrink-0 text-xs text-[#73818f]">
                      {due ? due.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '--'}
                    </span>
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const option = event.target.value as 'later' | 'tomorrow' | 'nextweek' | '';
                        event.target.value = '';
                        if (option) void snoozeQueueTask(task, option);
                      }}
                      className="shrink-0 rounded border border-[#c8ced3] px-2 py-1 text-xs text-[#5c6873]"
                    >
                      <option value="" disabled>Snooze…</option>
                      <option value="later">Later today</option>
                      <option value="tomorrow">Tomorrow 9 AM</option>
                      <option value="nextweek">Next week</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => void completeQueueTask(task, true)}
                      className="shrink-0 rounded bg-[#4dbd74] px-2.5 py-1.5 text-xs font-bold text-white hover:brightness-95"
                    >
                      Complete & Next
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {!loading && viewMode === 'board' ? (
        <PipelineBoard
          leads={filteredLeads}
          taskDueByLead={taskDueByLead}
          unreadByLead={unreadByLead}
          terminalCounts={{ won: stats.won, lost: stats.lost, inactive: stats.inactive }}
          onStatusChange={handlePipelineStatusChange}
          onSelectLead={(lead) => setSelectedLead(leads.find((candidate) => candidate.id === lead.id) ?? null)}
        />
      ) : null}

      {!loading && viewMode === 'list' ? (
        <div className="rounded border border-[#c8ced3] bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-[#f0f3f5] bg-[#f8f9fa] px-4 py-2.5">
            <input
              type="search"
              value={listSearch}
              onChange={(event) => setListSearch(event.target.value)}
              placeholder="Search name, email, phone, line, source?"
              className="w-72 max-w-full rounded border border-[#c8ced3] bg-white px-3 py-1.5 text-sm"
            />
            <p className="ml-auto text-xs font-semibold text-[#73818f]">
              {listLeads.length} of {filteredLeads.length} leads
            </p>
          </div>

          {selectedIds.size > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#1b8eb7]/30 bg-[#20a8d8]/10 px-4 py-2">
              <p className="text-sm font-bold text-[#167495]">
                {selectedIds.size} selected
                {selectedPremium > 0 ? (
                  <span className="ml-1 font-semibold text-[#4dbd74]">(${selectedPremium.toLocaleString()} est.)</span>
                ) : null}
              </p>
              <select
                defaultValue=""
                disabled={bulkBusy}
                onChange={(event) => {
                  const status = event.target.value;
                  event.target.value = '';
                  if (status) void bulkSetStatus(status);
                }}
                className="rounded border border-[#c8ced3] bg-white px-2 py-1 text-xs font-semibold text-[#5c6873]"
              >
                <option value="" disabled>Set status…</option>
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="quoted">Quoted</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="inactive">Inactive</option>
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={bulkFollowUpAt}
                  onChange={(event) => setBulkFollowUpAt(event.target.value)}
                  disabled={bulkBusy}
                  className="rounded border border-[#c8ced3] bg-white px-2 py-1 text-xs"
                />
                <button
                  type="button"
                  onClick={() => void bulkScheduleFollowUp()}
                  disabled={bulkBusy || !bulkFollowUpAt}
                  className="rounded bg-[#167495] px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50"
                >
                  Schedule follow-up
                </button>
              </div>
              <button
                type="button"
                onClick={() => void bulkDelete()}
                disabled={bulkBusy}
                className="rounded border border-[#f86c6b]/50 bg-white px-2.5 py-1 text-xs font-bold text-[#f86c6b] hover:bg-[#f86c6b]/10 disabled:opacity-50"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkBusy}
                className="ml-auto text-xs font-semibold text-[#73818f] hover:underline"
              >
                Clear selection
              </button>
              {bulkBusy ? <span className="text-xs font-semibold text-[#167495]">Working…</span> : null}
            </div>
          ) : null}

          {listLeads.length === 0 ? (
            <div className="p-6 text-center text-sm text-[#73818f]">
              {listSearch ? 'No leads match your search.' : 'No leads found.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-left text-sm">
                <thead className="border-b border-[#e1e6ea] bg-[#f8f9fa] text-xs uppercase tracking-wide text-[#73818f]">
                  <tr>
                    <th className="w-10 px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all leads"
                        className="h-4 w-4 cursor-pointer accent-[#20a8d8]"
                      />
                    </th>
                    {(
                      [
                        ['name', 'Lead', true, ''],
                        ['contact', 'Contact', false, 'w-44'],
                        ['status', 'Status', true, 'w-28'],
                        ['premium', 'Premium', true, 'w-24'],
                        ['followup', 'Follow-Up', true, 'w-28'],
                        ['source', 'Source', false, 'w-24'],
                        ['created', 'Created', true, 'w-24'],
                        ['actions', '', false, 'w-36'],
                      ] as Array<[string, string, boolean, string]>
                    ).map(([key, label, sortable, width]) => (
                      <th key={key} className={`px-3 py-2.5 font-bold ${width} ${key === 'premium' ? 'text-right' : ''}`}>
                        {sortable ? (
                          <button
                            type="button"
                            onClick={() => toggleListSort(key as ListSortKey)}
                            className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-[#167495]"
                          >
                            {label}
                            {listSort.key === key ? <span>{listSort.dir === 'asc' ? '\u25B2' : '\u25BC'}</span> : null}
                          </button>
                        ) : (
                          label
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f3f5]">
                  {listLeads.map((lead) => {
                    const premium = premiumOf(lead);
                    const dueAt = taskDueByLead[lead.id];
                    const due = dueAt ? new Date(dueAt) : null;
                    const overdue = due ? due.getTime() < Date.now() : false;
                    const dueToday =
                      due && !overdue
                        ? due.getTime() <= new Date(new Date().setHours(23, 59, 59, 999)).getTime()
                        : false;

                    return (
                      <tr
                        key={lead.id}
                        onClick={() => setSelectedLead(lead)}
                        className="cursor-pointer transition hover:bg-[#f0f3f5]/70"
                      >
                        <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(lead.id)}
                            onChange={() => toggleSelected(lead.id)}
                            aria-label={`Select ${lead.full_name}`}
                            className="h-4 w-4 cursor-pointer accent-[#20a8d8]"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="truncate font-semibold text-[#167495]">{lead.full_name}</p>
                          <p className="truncate text-xs text-[#73818f]">{lead.line_of_business || 'No line of business'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="max-w-40 truncate text-[#23282c]">{formatPhone(lead.phone) || '--'}</p>
                          <p className="max-w-40 truncate text-xs text-[#73818f]">{lead.email || '--'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded px-2 py-0.5 text-[11px] font-bold uppercase ${
                              STATUS_PILL_TONES[lead.status] ?? STATUS_PILL_TONES.new
                            }`}
                          >
                            {LEAD_STATUS_LABELS[lead.status as LeadStatus] ?? lead.status}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold text-[#23282c]">
                          {premium > 0 ? `$${premium.toLocaleString()}` : <span className="font-normal text-[#c8ced3]">--</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {due ? (
                            <span
                              className={`rounded px-2 py-0.5 text-[11px] font-bold ${
                                overdue
                                  ? 'bg-[#f86c6b] text-white'
                                  : dueToday
                                    ? 'bg-[#ffc107]/25 text-amber-800'
                                    : 'bg-[#f0f3f5] text-[#73818f]'
                              }`}
                            >
                              {overdue
                                ? 'Overdue'
                                : due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          ) : (
                            <span className="text-xs text-[#c8ced3]">--</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="rounded bg-[#f0f3f5] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#73818f]">
                            {lead.source || 'unknown'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-xs text-[#73818f]">
                          {new Date(lead.created_at).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2.5 text-right text-xs" onClick={(event) => event.stopPropagation()}>
                          <Link
                            href={`/clients/workspace?lead=${lead.id}`}
                            className="mr-2 font-semibold text-[#2f353a] hover:underline"
                          >
                            Client
                          </Link>
                          <button
                            type="button"
                            className="mr-2 font-semibold text-[#167495] hover:underline"
                            onClick={() => setEditingLead(lead)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="font-semibold text-[#c23934] hover:underline"
                            onClick={() => void handleRemoveLead(lead.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {showNewLead ? (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onCreated={(leadId) => {
            setShowNewLead(false);
            setPendingLeadId(leadId);
            void fetchLeads();
          }}
        />
      ) : null}

      {editingLead ? (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded border border-[#c8ced3] bg-white p-4 shadow-xl">
            <h2 className="mb-3 text-lg font-bold text-[#23282c]">Edit Lead</h2>
            <form onSubmit={handleUpdateLead} className="space-y-2">
              <input
                required
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.full_name}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, full_name: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.phone || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
              />
              <input
                type="email"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.email || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.line_of_business || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, line_of_business: e.target.value } : prev))}
              />
              <input
                type="text"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.source || ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, source: e.target.value } : prev))}
              />
              <select
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.status}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, status: e.target.value } : prev))}
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="quoted">Quoted</option>
                <option value="won">Won</option>
                <option value="lost">Lost</option>
                <option value="inactive">Inactive</option>
              </select>
              <input
                type="number"
                min="0"
                step="50"
                placeholder="Estimated premium ($)"
                className="w-full rounded border border-[#c8ced3] px-3 py-2 text-sm"
                value={editingLead.estimated_premium != null && editingLead.estimated_premium !== '' ? String(editingLead.estimated_premium) : ''}
                onChange={(e) => setEditingLead((prev) => (prev ? { ...prev, estimated_premium: e.target.value } : prev))}
              />

              <button
                type="submit"
                disabled={isSavingEdit}
                className="w-full rounded bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7] disabled:opacity-60"
              >
                {isSavingEdit ? 'Saving Changes...' : 'Save Changes'}
              </button>
              <button
                type="button"
                onClick={() => setEditingLead(null)}
                className="w-full rounded bg-[#e4e5e6] px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#c8ced3]"
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      ) : null}

      {selectedLead ? (
        <LeadWorkspace
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onChanged={() => {
            void fetchLeads(false);
            void fetchLeadTasks();
          }}
        />
      ) : null}
    </SectionLayout>
  );
}
