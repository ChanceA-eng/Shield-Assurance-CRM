'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, GitMerge, X } from 'lucide-react';

interface DupLead {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  source: string | null;
  status: string;
  estimated_premium: number | string | null;
  created_at: string;
  richness: number;
  contacts: number;
  renewals: number;
}

interface DupGroup {
  reason: string;
  suggested_survivor: string;
  leads: DupLead[];
}

interface DuplicatesModalProps {
  onClose: () => void;
  onMerged: () => void;
}

type FieldKey = 'full_name' | 'email' | 'phone' | 'address' | 'line_of_business' | 'estimated_premium';

const FIELD_LABELS: Record<FieldKey, string> = {
  full_name: 'Name',
  email: 'Email',
  phone: 'Phone',
  address: 'Address',
  line_of_business: 'Line of business',
  estimated_premium: 'Est. premium',
};

function fieldValue(lead: DupLead, key: FieldKey): string {
  const value = lead[key];
  return value === null || value === undefined ? '' : String(value);
}

export default function DuplicatesModal({ onClose, onMerged }: DuplicatesModalProps): JSX.Element {
  const [groups, setGroups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<DupGroup | null>(null);
  const [survivorId, setSurvivorId] = useState<string>('');
  const [finalFields, setFinalFields] = useState<Record<FieldKey, string>>({
    full_name: '', email: '', phone: '', address: '', line_of_business: '', estimated_premium: '',
  });
  const [isMerging, setIsMerging] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leads/duplicates', { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to scan for duplicates.');
        return;
      }
      const payload = (await res.json()) as { groups: DupGroup[] };
      setGroups(payload.groups);
    } catch {
      setError('Failed to scan for duplicates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startReview = (group: DupGroup): void => {
    const survivor = group.leads.find((lead) => lead.id === group.suggested_survivor) ?? group.leads[0];
    setSurvivorId(survivor.id);
    // Default final values: survivor's value, else first non-empty among the group.
    const defaults = {} as Record<FieldKey, string>;
    (Object.keys(FIELD_LABELS) as FieldKey[]).forEach((key) => {
      defaults[key] =
        fieldValue(survivor, key) ||
        group.leads.map((lead) => fieldValue(lead, key)).find((value) => value) ||
        '';
    });
    setFinalFields(defaults);
    setReviewing(group);
  };

  const confirmMerge = async (): Promise<void> => {
    if (!reviewing || !survivorId) return;
    setIsMerging(true);
    setError(null);
    try {
      const res = await fetch('/api/leads/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          survivor_id: survivorId,
          merge_ids: reviewing.leads.filter((lead) => lead.id !== survivorId).map((lead) => lead.id),
          fields: {
            full_name: finalFields.full_name,
            email: finalFields.email || null,
            phone: finalFields.phone || null,
            address: finalFields.address || null,
            line_of_business: finalFields.line_of_business || null,
            estimated_premium: finalFields.estimated_premium || null,
          },
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({ message: 'Merge failed.' }))) as { message?: string };
        setError(payload.message ?? 'Merge failed.');
        return;
      }
      setReviewing(null);
      onMerged();
      await load();
    } catch {
      setError('Merge failed.');
    } finally {
      setIsMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded border border-[#c8ced3] bg-white shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-[#f0f3f5] bg-[#f8f9fa] px-4 py-3">
          <div className="flex items-center gap-2">
            {reviewing ? (
              <button type="button" onClick={() => setReviewing(null)} className="rounded p-1 text-[#73818f] hover:bg-[#f0f3f5]">
                <ArrowLeft className="h-4 w-4" />
              </button>
            ) : null}
            <h2 className="text-lg font-bold text-[#23282c]">
              {reviewing ? 'Review Merge' : `Duplicate Leads ${loading ? '' : `(${groups.length} group${groups.length === 1 ? '' : 's'})`}`}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-[#73818f] hover:bg-[#f0f3f5]" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? <div className="mx-4 mt-3 shrink-0 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {!reviewing ? (
            <>
              {loading ? <p className="text-sm text-[#73818f]">Scanning your book for duplicates…</p> : null}
              {!loading && groups.length === 0 ? (
                <p className="rounded border border-dashed border-[#c8ced3] p-6 text-center text-sm text-[#73818f]">
                  No duplicate leads detected. Clean book.
                </p>
              ) : null}
              <div className="space-y-3">
                {groups.map((group, index) => (
                  <div key={index} className="rounded border border-[#c8ced3]">
                    <div className="flex items-center justify-between border-b border-[#f0f3f5] bg-[#f8f9fa] px-3 py-2">
                      <p className="text-sm font-semibold text-[#23282c]">
                        {group.leads.length} leads <span className="font-normal text-[#73818f]">— {group.reason}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => startReview(group)}
                        className="inline-flex items-center gap-1.5 rounded bg-[#20a8d8] px-3 py-1.5 text-xs font-bold text-white hover:brightness-95"
                      >
                        <GitMerge className="h-3.5 w-3.5" />
                        Review merge
                      </button>
                    </div>
                    <ul className="divide-y divide-[#f0f3f5]">
                      {group.leads.map((lead) => (
                        <li key={lead.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="min-w-0 flex-1 truncate font-semibold text-[#167495]">{lead.full_name}</span>
                          <span className="hidden text-xs text-[#73818f] md:block">{lead.email ?? lead.phone ?? 'no contact'}</span>
                          <span className="shrink-0 rounded bg-[#f0f3f5] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[#73818f]">
                            {lead.contacts} contacts · {lead.renewals} renewals
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-[#5c6873]">
                Pick which values win, edit anything, then confirm. Everything else is pulled automatically from all{' '}
                {reviewing.leads.length} leads — contacts, renewals, industry, website, revenue, risk data, notes, and
                tasks all move to the surviving record. Nothing is lost.
              </p>

              {/* Survivor selection */}
              <div className="rounded border border-[#c8ced3]">
                <div className="border-b border-[#f0f3f5] bg-[#f8f9fa] px-3 py-2 text-sm font-semibold text-[#5c6873]">Surviving record</div>
                {reviewing.leads.map((lead) => (
                  <label key={lead.id} className="flex cursor-pointer items-center gap-2 border-t border-[#f0f3f5] px-3 py-2 text-sm first:border-t-0 hover:bg-[#f0f3f5]/60">
                    <input
                      type="radio"
                      name="survivor"
                      checked={survivorId === lead.id}
                      onChange={() => setSurvivorId(lead.id)}
                      className="accent-[#20a8d8]"
                    />
                    <span className="min-w-0 flex-1 truncate font-semibold text-[#23282c]">{lead.full_name}</span>
                    <span className="shrink-0 text-xs text-[#73818f]">
                      richness {lead.richness} · {new Date(lead.created_at).toLocaleDateString()}
                    </span>
                  </label>
                ))}
              </div>

              {/* Field comparison + final values */}
              <div className="overflow-x-auto rounded border border-[#c8ced3]">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-[#e1e6ea] bg-[#f8f9fa] text-xs uppercase tracking-wide text-[#73818f]">
                    <tr>
                      <th className="w-32 px-3 py-2 font-bold">Field</th>
                      {reviewing.leads.map((lead) => (
                        <th key={lead.id} className="px-3 py-2 font-bold">
                          {lead.id === survivorId ? '★ ' : ''}
                          {lead.full_name.slice(0, 18)}
                        </th>
                      ))}
                      <th className="w-56 px-3 py-2 font-bold text-[#167495]">Final value (editable)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f3f5]">
                    {(Object.keys(FIELD_LABELS) as FieldKey[]).map((key) => (
                      <tr key={key}>
                        <td className="px-3 py-2 font-semibold text-[#5c6873]">{FIELD_LABELS[key]}</td>
                        {reviewing.leads.map((lead) => {
                          const value = fieldValue(lead, key);
                          return (
                            <td key={lead.id} className="px-3 py-2">
                              {value ? (
                                <button
                                  type="button"
                                  onClick={() => setFinalFields((prev) => ({ ...prev, [key]: value }))}
                                  className={`break-all text-left hover:underline ${finalFields[key] === value ? 'font-semibold text-[#167495]' : 'text-[#23282c]'}`}
                                  title="Use this value"
                                >
                                  {value}
                                </button>
                              ) : (
                                <span className="text-[#c8ced3]">--</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={finalFields[key]}
                            onChange={(event) => setFinalFields((prev) => ({ ...prev, [key]: event.target.value }))}
                            className="w-full rounded border border-[#c8ced3] px-2 py-1 text-sm"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReviewing(null)}
                  className="rounded border border-[#c8ced3] bg-white px-3 py-2 text-sm font-semibold text-[#5c6873] hover:bg-[#f0f3f5]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void confirmMerge()}
                  disabled={isMerging || !finalFields.full_name.trim()}
                  className="inline-flex items-center gap-1.5 rounded bg-[#4dbd74] px-4 py-2 text-sm font-bold text-white hover:brightness-95 disabled:opacity-50"
                >
                  <GitMerge className="h-4 w-4" />
                  {isMerging ? 'Merging…' : `Merge ${reviewing.leads.length} into 1`}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
