'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionLayout from '../../../components/crm/SectionLayout';

interface DueInteraction {
  id: string;
  lead_id: string;
  content: string;
  follow_up_at: string | null;
  follow_up_completed: boolean;
  created_at: string;
  leads?: {
    full_name?: string | null;
    source?: string | null;
    status?: string | null;
  } | null;
}

export default function FollowUpsPage(): JSX.Element {
  const [items, setItems] = useState<DueInteraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDue = async (): Promise<void> => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/interactions?dueList=true', { cache: 'no-store' });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({ message: 'Failed to load follow-ups.' }))) as { message?: string };
          setError(payload.message ?? 'Failed to load follow-ups.');
          setLoading(false);
          return;
        }

        const data = (await response.json()) as DueInteraction[];
        setItems(data);
      } catch {
        setError('Network error while loading follow-ups.');
      } finally {
        setLoading(false);
      }
    };

    void fetchDue();
    const intervalId = window.setInterval(() => {
      void fetchDue();
    }, 45000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return (
    <SectionLayout title="Overdue Follow-Ups">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Items due now or overdue for follow-up completion.</p>
        <Link href="/leads" className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]">
          Back To Leads
        </Link>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading follow-ups...</div> : null}

      {!loading ? (
        <div className="overflow-x-auto rounded border border-[#dddbda] bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No overdue follow-ups.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Prospect</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Lead Status</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Interaction Note</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0f62af]">{item.leads?.full_name || 'Unknown Lead'}</td>
                    <td className="px-3 py-2">{item.leads?.source || '--'}</td>
                    <td className="px-3 py-2">{item.leads?.status || '--'}</td>
                    <td className="px-3 py-2">{item.follow_up_at ? new Date(item.follow_up_at).toLocaleString() : '--'}</td>
                    <td className="max-w-[560px] px-3 py-2 text-xs text-[#2f2f2f]">{item.content}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </SectionLayout>
  );
}
