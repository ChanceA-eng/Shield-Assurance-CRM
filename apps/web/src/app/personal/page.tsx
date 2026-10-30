'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import SectionLayout from '../../components/crm/SectionLayout';

type PersonalQueueRow = {
  id: string;
  firstName: string;
  lastName: string;
  primaryEmail: string;
  primaryPhone: string;
  state: string;
  zipCode: string;
  currentCarrier: string | null;
  currentPolicyExpiration: string | null;
  createdAt: string;
};

export default function PersonalQueuePage(): JSX.Element {
  const [rows, setRows] = useState<PersonalQueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/personal/accounts', { cache: 'no-store' });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({ message: 'Failed to load personal submissions.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to load personal submissions.');
        setLoading(false);
        return;
      }

      const payload = (await res.json()) as PersonalQueueRow[];
      setRows(payload);
      setLoading(false);
    })();
  }, []);

  const convertToClient = async (submissionId: string): Promise<void> => {
    setError(null);
    setConvertingId(submissionId);

    const response = await fetch(`/api/convert?id=${submissionId}&type=personal`, {
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
    <SectionLayout title="Personal">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-[#5c6873]">Personal submission queue for Auto, Home, and Umbrella opportunities.</p>
        <Link href={'/personal/new' as Route} className="rounded border border-[#1b8eb7] bg-[#20a8d8] px-3 py-2 text-sm font-semibold text-white hover:bg-[#1b8eb7]">
          + New
        </Link>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {loading ? <div className="text-sm text-[#73818f]">Loading personal submissions...</div> : null}

      {!loading ? (
        <div className="rounded border border-[#c8ced3] bg-white shadow-sm">
          {rows.length === 0 ? (
            <div className="p-4 text-sm text-[#73818f]">No personal submissions yet.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[#f8f9fa] text-[#73818f]">
                <tr>
                  <th className="px-3 py-2">Applicant</th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">State</th>
                  <th className="px-3 py-2">Carrier</th>
                  <th className="px-3 py-2">Policy Exp</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#f0f3f5]">
                    <td className="px-3 py-2 font-semibold text-[#20a8d8]">{row.firstName} {row.lastName}</td>
                    <td className="px-3 py-2">{row.primaryEmail}</td>
                    <td className="px-3 py-2">{row.primaryPhone}</td>
                    <td className="px-3 py-2">{row.state} {row.zipCode}</td>
                    <td className="px-3 py-2">{row.currentCarrier ?? '--'}</td>
                    <td className="px-3 py-2">{row.currentPolicyExpiration ?? '--'}</td>
                    <td className="px-3 py-2">{new Date(row.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={() => void convertToClient(row.id)}
                        disabled={convertingId === row.id}
                        className="rounded border border-emerald-700 bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {convertingId === row.id ? 'Converting...' : 'Convert To Client'}
                      </button>
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
