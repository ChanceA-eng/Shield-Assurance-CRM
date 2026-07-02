'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import SectionLayout from '../../../components/crm/SectionLayout';

type QueueRow = {
  id: string;
  legalName: string;
  industryGroup: string;
  riskCompletenessScore: number | null;
  createdAt: string;
};

export default function CommercialQueuePage(): JSX.Element {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/commercial/intake', { cache: 'no-store' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({ message: 'Failed to load intake queue.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to load intake queue.');
        setLoading(false);
        return;
      }

      const payload = (await res.json()) as QueueRow[];
      setRows(payload);
      setLoading(false);
    })();
  }, []);

  const convertToClient = async (submissionId: string): Promise<void> => {
    setError(null);
    setConvertingId(submissionId);

    const response = await fetch(`/api/convert?id=${submissionId}&type=commercial`, {
      method: 'POST',
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Conversion failed.' }))) as { message?: string };
      setError(payload.message ?? 'Conversion failed.');
      setConvertingId(null);
      return;
    }

    const payload = (await response.json()) as { clientId: string };
    window.location.href = `/clients/${payload.clientId}`;
  };

  return (
    <SectionLayout title="Commercial Queue">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#3e3e3c]">Monitor pre-client commercial intake accounts and launch underwriting workflows.</p>
        <Link href={'/commercial/intake' as Route} className="rounded border border-[#0163b3] bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]">
          + New Intake
        </Link>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading commercial queue...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {rows.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No intake records yet.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Business</th>
                  <th className="px-3 py-2">Industry</th>
                  <th className="px-3 py-2">Completeness</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">{row.legalName}</td>
                    <td className="px-3 py-2">{row.industryGroup}</td>
                    <td className="px-3 py-2">{row.riskCompletenessScore ?? 0}%</td>
                    <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-3">
                        <Link href={`/commercial/intake?id=${row.id}` as Route} className="font-semibold text-[#0f62af] hover:underline">
                          Open Intake
                        </Link>
                        <button
                          type="button"
                          onClick={() => void convertToClient(row.id)}
                          disabled={convertingId === row.id}
                          className="rounded border border-emerald-700 bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {convertingId === row.id ? 'Converting...' : 'Convert To Client'}
                        </button>
                      </div>
                    </td>
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
