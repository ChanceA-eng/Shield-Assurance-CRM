'use client';

import { useMemo, useState } from 'react';
import { Mail, Phone } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  ACTIVE_LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LOST_REASONS,
  LOST_REASON_LABELS,
  type LeadStatus,
  type LostReason,
} from '../../lib/lead-pipeline';

export interface PipelineLead {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  line_of_business?: string | null;
  source?: string | null;
  status: string;
  estimated_premium?: number | string | null;
  stage_changed_at?: string | null;
  created_at: string;
}

interface PipelineBoardProps {
  leads: PipelineLead[];
  /** lead_id -> earliest open task due date (ISO). Neutral next-touch chips. */
  taskDueByLead: Record<string, string>;
  /** lead_id -> unread inbound message count. The attention signal on cards. */
  unreadByLead: Record<string, number>;
  /** Totals for the terminal outcomes, shown on the drop zones. */
  terminalCounts?: Partial<Record<'won' | 'lost' | 'inactive', number>>;
  onStatusChange: (leadId: string, status: LeadStatus, lostReason?: LostReason) => Promise<void>;
  onSelectLead: (lead: PipelineLead) => void;
}

const COLUMN_ACCENTS: Record<LeadStatus, string> = {
  new: 'border-t-cui-info',
  contacted: 'border-t-cui-primary',
  quoted: 'border-t-cui-warning',
  won: 'border-t-cui-success',
  lost: 'border-t-cui-danger',
  inactive: 'border-t-cui-secondary',
};

const TERMINAL_ZONES: LeadStatus[] = ['won', 'lost', 'inactive'];

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,]/g, ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return `$${Math.round(value).toLocaleString()}`;
}

function daysInStage(lead: PipelineLead): number {
  const since = lead.stage_changed_at ?? lead.created_at;
  const time = new Date(since).getTime();
  if (Number.isNaN(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / (1000 * 60 * 60 * 24)));
}

function AgingChip({ days }: { days: number }): JSX.Element | null {
  if (days < 1) return null;
  const tone =
    days >= 14
      ? 'bg-cui-danger/15 text-cui-danger'
      : days >= 7
        ? 'bg-cui-warning/20 text-amber-700'
        : 'bg-cui-light text-cui-muted';
  return <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${tone}`} title={`${days} days in stage`}>{days}d</span>;
}

function FollowUpChip({ dueAt }: { dueAt?: string }): JSX.Element | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  // Neutral by design: overdue alarms live in the Work Queue and bell, not on cards.
  return (
    <span className="shrink-0 rounded bg-cui-light px-1.5 py-0.5 text-[10px] font-semibold text-cui-muted" title="Next follow-up">
      {due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
    </span>
  );
}

function UnreadChip({ count }: { count?: number }): JSX.Element | null {
  if (!count || count < 1) return null;
  return (
    <span className="shrink-0 rounded bg-cui-primary px-1.5 py-0.5 text-[10px] font-bold text-white" title={`${count} unread message(s)`}>
      {count} new
    </span>
  );
}

function LeadCard({
  lead,
  dueAt,
  unread,
  onSelect,
  dragging,
}: {
  lead: PipelineLead;
  dueAt?: string;
  unread?: number;
  onSelect?: (lead: PipelineLead) => void;
  dragging?: boolean;
}): JSX.Element {
  const premium = toNumber(lead.estimated_premium);
  return (
    <div
      onClick={onSelect ? () => onSelect(lead) : undefined}
      className={`cursor-grab rounded border border-cui-border/60 bg-white p-2.5 text-left shadow-card transition hover:border-cui-primary/60 ${
        dragging ? 'rotate-2 shadow-panel' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-semibold text-cui-text">{lead.full_name}</p>
        <div className="flex items-center gap-1">
          <UnreadChip count={unread} />
          <FollowUpChip dueAt={dueAt} />
          <AgingChip days={daysInStage(lead)} />
        </div>
      </div>
      <p className="mt-0.5 truncate text-xs text-cui-muted">{lead.line_of_business || 'No line of business'}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate rounded bg-cui-light px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cui-muted">
          {lead.source || 'unknown'}
        </span>
        <div className="flex items-center gap-1.5">
          {lead.phone ? (
            <a
              href={`tel:${lead.phone}`}
              onClick={(event) => event.stopPropagation()}
              className="rounded p-1 text-cui-muted transition hover:bg-cui-light hover:text-cui-primary"
              title={`Call ${lead.phone}`}
            >
              <Phone className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {lead.email ? (
            <a
              href={`mailto:${lead.email}`}
              onClick={(event) => event.stopPropagation()}
              className="rounded p-1 text-cui-muted transition hover:bg-cui-light hover:text-cui-primary"
              title={`Email ${lead.email}`}
            >
              <Mail className="h-3.5 w-3.5" />
            </a>
          ) : null}
          {premium > 0 ? <span className="text-xs font-bold text-cui-success">{formatMoney(premium)}</span> : null}
        </div>
      </div>
    </div>
  );
}

function DraggableCard({
  lead,
  dueAt,
  unread,
  onSelect,
}: {
  lead: PipelineLead;
  dueAt?: string;
  unread?: number;
  onSelect: (lead: PipelineLead) => void;
}): JSX.Element {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: lead.id });

  return (
    <div ref={setNodeRef} {...listeners} {...attributes} className={isDragging ? 'opacity-40' : ''}>
      <LeadCard lead={lead} dueAt={dueAt} unread={unread} onSelect={onSelect} />
    </div>
  );
}

function StageColumn({
  status,
  leads,
  taskDueByLead,
  unreadByLead,
  onSelectLead,
}: {
  status: LeadStatus;
  leads: PipelineLead[];
  taskDueByLead: Record<string, string>;
  unreadByLead: Record<string, number>;
  onSelectLead: (lead: PipelineLead) => void;
}): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const totalPremium = leads.reduce((sum, lead) => sum + toNumber(lead.estimated_premium), 0);

  return (
    <div
      className={`flex h-full min-w-0 flex-1 flex-col rounded border border-cui-border/60 border-t-4 bg-cui-light/60 ${COLUMN_ACCENTS[status]} ${
        isOver ? 'ring-2 ring-cui-primary/60' : ''
      }`}
    >
      <div className="flex shrink-0 items-center justify-between px-3 py-2">
        <p className="text-sm font-bold text-cui-text">
          {LEAD_STATUS_LABELS[status]} <span className="font-normal text-cui-muted">({leads.length})</span>
        </p>
        {totalPremium > 0 ? <p className="text-xs font-bold text-cui-success">{formatMoney(totalPremium)}</p> : null}
      </div>
      <div ref={setNodeRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {leads.length === 0 ? (
          <p className="rounded border border-dashed border-cui-border/80 p-3 text-center text-xs text-cui-muted">
            Drop leads here
          </p>
        ) : (
          leads.map((lead) => (
            <DraggableCard key={lead.id} lead={lead} dueAt={taskDueByLead[lead.id]} unread={unreadByLead[lead.id]} onSelect={onSelectLead} />
          ))
        )}
      </div>
    </div>
  );
}

function TerminalZone({ status, highlight, count }: { status: LeadStatus; highlight: boolean; count?: number }): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const tone =
    status === 'won'
      ? 'border-cui-success/60 text-cui-success'
      : status === 'lost'
        ? 'border-cui-danger/60 text-cui-danger'
        : 'border-cui-border text-cui-muted';

  return (
    <div
      ref={setNodeRef}
      className={`flex h-10 flex-1 items-center justify-center gap-1.5 rounded border-2 border-dashed bg-white text-sm font-bold transition ${tone} ${
        isOver ? 'scale-[1.03] bg-cui-light ring-2 ring-current' : highlight ? 'bg-cui-light/80' : ''
      }`}
    >
      {LEAD_STATUS_LABELS[status]}
      {typeof count === 'number' ? <span className="font-normal opacity-70">({count})</span> : null}
    </div>
  );
}

export default function PipelineBoard({
  leads,
  taskDueByLead,
  unreadByLead,
  terminalCounts,
  onStatusChange,
  onSelectLead,
}: PipelineBoardProps): JSX.Element {
  const [activeLead, setActiveLead] = useState<PipelineLead | null>(null);
  const [pendingLost, setPendingLost] = useState<PipelineLead | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Small activation distance keeps card clicks working alongside drags.
      activationConstraint: { distance: 6 },
    }),
  );

  const columns = useMemo(() => {
    const grouped: Record<string, PipelineLead[]> = { new: [], contacted: [], quoted: [] };
    for (const lead of leads) {
      const key = lead.status in grouped ? lead.status : 'new';
      grouped[key].push(lead);
    }
    return grouped;
  }, [leads]);

  const handleDragStart = (event: DragStartEvent): void => {
    const lead = leads.find((candidate) => candidate.id === event.active.id);
    setActiveLead(lead ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent): Promise<void> => {
    const lead = activeLead;
    setActiveLead(null);

    const targetStatus = event.over?.id as LeadStatus | undefined;
    if (!lead || !targetStatus || targetStatus === lead.status) return;

    if (targetStatus === 'lost') {
      setPendingLost(lead);
      return;
    }

    await onStatusChange(lead.id, targetStatus);
  };

  const confirmLost = async (reason: LostReason): Promise<void> => {
    if (!pendingLost) return;
    setIsSaving(true);
    try {
      await onStatusChange(pendingLost.id, 'lost', reason);
    } finally {
      setIsSaving(false);
      setPendingLost(null);
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={(event) => void handleDragEnd(event)}>
      {/* Board fills the remaining viewport; columns scroll internally. */}
      <div className="flex h-[calc(100vh-17rem)] min-h-[24rem] flex-col gap-3">
        {/* Terminal drop strip stays within reach regardless of column length. */}
        <div className="flex shrink-0 gap-3">
          {TERMINAL_ZONES.map((status) => (
            <TerminalZone
              key={status}
              status={status}
              highlight={Boolean(activeLead)}
              count={terminalCounts?.[status as 'won' | 'lost' | 'inactive']}
            />
          ))}
        </div>

        <div className="flex min-h-0 flex-1 gap-3">
          {ACTIVE_LEAD_STATUSES.map((status) => (
            <StageColumn
              key={status}
              status={status}
              leads={columns[status] ?? []}
              taskDueByLead={taskDueByLead}
              unreadByLead={unreadByLead}
              onSelectLead={onSelectLead}
            />
          ))}
        </div>
      </div>

      <DragOverlay>{activeLead ? <LeadCard lead={activeLead} dueAt={taskDueByLead[activeLead.id]} unread={unreadByLead[activeLead.id]} dragging /> : null}</DragOverlay>

      {pendingLost ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded border border-cui-border/60 bg-white p-4 shadow-panel">
            <h2 className="text-base font-bold text-cui-text">Mark “{pendingLost.full_name}” as Lost</h2>
            <p className="mt-1 text-sm text-cui-muted">Why was this lead lost?</p>
            <div className="mt-3 space-y-1.5">
              {LOST_REASONS.map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={isSaving}
                  onClick={() => void confirmLost(reason)}
                  className="w-full rounded border border-cui-border/60 px-3 py-2 text-left text-sm text-cui-text transition hover:border-cui-danger/60 hover:bg-cui-danger/5 disabled:opacity-50"
                >
                  {LOST_REASON_LABELS[reason]}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPendingLost(null)}
              disabled={isSaving}
              className="mt-3 w-full rounded bg-cui-light px-3 py-2 text-sm font-semibold text-cui-muted hover:bg-cui-border/40"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </DndContext>
  );
}
