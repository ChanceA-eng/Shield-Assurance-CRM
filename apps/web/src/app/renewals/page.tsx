"use client";

import React, { useEffect, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';

type RenewalWindow = '30' | '60' | '90' | 'overdue';

interface RenewalPolicy {
  id: string;
  insured_name: string;
  carrier: string;
  line_of_business: string;
  premium: number;
  renewal_date: string;
  status: string;
}

interface RenewalsResponse {
  window: RenewalWindow;
  counts: Record<RenewalWindow, number>;
  items: RenewalPolicy[];
}

const windows: Array<{ value: RenewalWindow; label: string }> = [
  { value: '30', label: '30 Days' },
  { value: '60', label: '60 Days' },
  { value: '90', label: '90 Days' },
  { value: 'overdue', label: 'Overdue' },
];

export default function RenewalsPage(): JSX.Element {
  const [selectedWindow, setSelectedWindow] = useState<RenewalWindow>('30');
  const [renewals, setRenewals] = useState<RenewalPolicy[]>([]);
  const [counts, setCounts] = useState<Record<RenewalWindow, number>>({
    '30': 0,
    '60': 0,
    '90': 0,
    overdue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRenewals = async (window: RenewalWindow): Promise<void> => {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/renewals?window=${window}`, { cache: 'no-store' });
    if (!res.ok) {
      setError('Failed to load renewals.');
      setLoading(false);
      return;
    }

    const data = (await res.json()) as RenewalsResponse;
    setRenewals(data.items ?? []);
    setCounts(data.counts);
    setLoading(false);
  };

  useEffect(() => {
    void fetchRenewals(selectedWindow);
  }, [selectedWindow]);

  return (
    <SectionLayout title="Renewals">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#3e3e3c]">Automatic renewal detection from active and issued policies.</p>
        <div className="flex flex-wrap gap-2">
          {windows.map((window) => (
            <button
              key={window.value}
              type="button"
              onClick={() => setSelectedWindow(window.value)}
              className={`rounded border px-3 py-2 text-sm font-semibold ${
                selectedWindow === window.value
                  ? 'border-[#0163b3] bg-[#0176d3] text-white'
                  : 'border-[#dddbda] bg-white text-[#3e3e3c] hover:bg-[#f8f8f7]'
              }`}
            >
              {window.label} ({counts[window.value] ?? 0})
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading renewals...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#dddbda] bg-white shadow-sm">
          {renewals.length === 0 ? (
            <div className="p-4 text-sm text-[#6a6a6a]">No renewals found for this window.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f8f7] text-[#6a6a6a]">
                <tr>
                  <th className="px-3 py-2">Insured</th>
                  <th className="px-3 py-2">Carrier</th>
                  <th className="px-3 py-2">LOB</th>
                  <th className="px-3 py-2">Premium</th>
                  <th className="px-3 py-2">Renewal Date</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {renewals.map((policy) => (
                  <tr key={policy.id} className="border-t border-[#f3f2f1]">
                    <td className="px-3 py-2 font-semibold text-[#0176d3]">{policy.insured_name}</td>
                    <td className="px-3 py-2">{policy.carrier}</td>
                    <td className="px-3 py-2">{policy.line_of_business}</td>
                    <td className="px-3 py-2">${policy.premium.toLocaleString()}</td>
                    <td className="px-3 py-2">{policy.renewal_date}</td>
                    <td className="px-3 py-2">{policy.status}</td>
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
