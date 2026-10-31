'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { UserPlus, X } from 'lucide-react';

interface AttentionLead {
  id: string;
  full_name: string;
  line_of_business: string | null;
  source: string | null;
  arrived_at: string;
}

const DISMISS_KEY = 'dismissed-lead-banners';

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function relativeTime(value: string): string {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Thin full-width banner shown on every page while a new website lead is
 * waiting in "new". Disappears automatically once the lead moves stages;
 * the producer can also dismiss it per lead.
 */
export default function NewLeadBanner(): JSX.Element | null {
  const [leads, setLeads] = useState<AttentionLead[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => (typeof window === 'undefined' ? new Set() : readDismissed()));

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/leads/attention', { cache: 'no-store' });
      if (!res.ok) return;
      const payload = (await res.json()) as { leads: AttentionLead[] };
      setLeads(payload.leads);
    } catch {
      // Banner is best-effort.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const visible = leads.filter((lead) => !dismissed.has(lead.id));
  if (visible.length === 0) return null;

  const lead = visible[0];
  const extra = visible.length - 1;

  const dismiss = (id: string): void => {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    try {
      window.localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
    } catch {
      // localStorage unavailable — dismissal just won't persist.
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-2.5 border-b border-orange-300 bg-orange-100 px-4 py-1.5 text-sm">
      <UserPlus className="h-4 w-4 shrink-0 text-orange-700" />
      <p className="min-w-0 flex-1 truncate text-cui-text">
        <span className="font-bold text-orange-900">New website lead:</span>{' '}
        <Link href={`/leads?lead=${lead.id}` as Route} className="font-semibold text-orange-800 underline decoration-orange-400 hover:text-orange-950">
          {lead.full_name}
        </Link>
        {lead.line_of_business ? <span className="text-orange-900/70"> · {lead.line_of_business}</span> : null}
        <span className="text-orange-900/70"> · {relativeTime(lead.arrived_at)}</span>
        {extra > 0 ? (
          <Link href={'/leads' as Route} className="ml-2 font-semibold text-orange-800 underline decoration-orange-400 hover:text-orange-950">
            +{extra} more waiting
          </Link>
        ) : null}
      </p>
      <Link
        href={`/leads?lead=${lead.id}` as Route}
        className="shrink-0 rounded bg-orange-600 px-2.5 py-0.5 text-xs font-semibold text-white transition hover:bg-orange-700"
      >
        Open profile
      </Link>
      <button
        type="button"
        onClick={() => dismiss(lead.id)}
        className="shrink-0 rounded p-0.5 text-orange-700 transition hover:text-orange-950"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
