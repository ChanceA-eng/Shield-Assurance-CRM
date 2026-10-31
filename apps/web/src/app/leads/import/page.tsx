'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, FileUp, Users, Wrench } from 'lucide-react';
import SectionLayout from '../../../components/crm/SectionLayout';
import DuplicatesModal from '../DuplicatesModal';
import NewLeadModal from '../NewLeadModal';

interface BatchSummary {
  id: string;
  file_name: string;
  vendor_profile: string;
  status: string;
  row_count: number;
  prospect_count: number;
  duplicate_count: number;
  committed_count: number;
  created_at: string;
}

interface StagedProspectRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  line_of_business: string | null;
  disposition: string;
  duplicate_of: string | null;
  payload: {
    profile?: {
      kind?: string;
      contacts?: Array<{ name: string }>;
      renewals?: Array<{ type: string; date: string; carrier?: string | null }>;
      vehicles?: Array<{ make?: string | null; model?: string | null; year?: string | null }>;
      current_carrier?: string | null;
      coverage?: string | null;
    };
  } | null;
}

const PROFILE_LABELS: Record<string, string> = {
  commercial: 'Commercial',
  personal_auto: 'Personal Auto',
  generic: 'Generic',
};

function prettyDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ImportCenterPage(): JSX.Element {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [activeBatch, setActiveBatch] = useState<BatchSummary | null>(null);
  const [prospects, setProspects] = useState<StagedProspectRow[]>([]);
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; full_name: string; email: string; phone: string } | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [showNewLead, setShowNewLead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBatches = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/import', { cache: 'no-store' });
      setBatches(res.ok ? ((await res.json()) as BatchSummary[]) : []);
    } catch {
      setBatches([]);
    }
  }, []);

  const openBatch = useCallback(async (batchId: string): Promise<void> => {
    setError(null);
    try {
      const res = await fetch(`/api/import/${encodeURIComponent(batchId)}`, { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to load batch.');
        return;
      }
      const payload = (await res.json()) as { batch: BatchSummary; prospects: StagedProspectRow[] };
      setActiveBatch(payload.batch);
      setProspects(payload.prospects);
      setIncluded(
        new Set(
          payload.prospects
            .filter((row) => row.disposition === 'pending' && (row.email?.trim() || row.phone?.trim()))
            .map((row) => row.id),
        ),
      );
    } catch {
      setError('Failed to load batch.');
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const handleUpload = async (file: File): Promise<void> => {
    setIsUploading(true);
    setError(null);
    setNotice(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const payload = (await res.json().catch(() => ({}))) as {
        batch_id?: string;
        vendor_profile?: string;
        row_count?: number;
        prospect_count?: number;
        duplicate_count?: number;
        message?: string;
      };
      if (!res.ok || !payload.batch_id) {
        setError(payload.message ?? 'Import failed.');
        return;
      }
      setNotice(
        payload.vendor_profile === 'generic'
          ? `Parsed ${payload.row_count} rows into ${payload.prospect_count} prospects. This file layout isn't fully recognized — names and contact info were mapped, and all remaining columns were preserved under each prospect's Additional Data. Review carefully before committing.`
          : `Parsed ${payload.row_count} rows into ${payload.prospect_count} prospects (${PROFILE_LABELS[payload.vendor_profile ?? 'generic']}), ${payload.duplicate_count} duplicate(s) flagged. Review and commit below.`,
      );
      await loadBatches();
      await openBatch(payload.batch_id);
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleCommit = async (): Promise<void> => {
    if (!activeBatch || included.size === 0) return;
    setIsCommitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/${encodeURIComponent(activeBatch.id)}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ include_ids: [...included] }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        committed?: number;
        tasks_created?: number;
        failed?: number;
        blocked_no_contact?: number;
        message?: string;
      };
      if (!res.ok) {
        setError(payload.message ?? 'Commit failed.');
        return;
      }
      setNotice(
        `Committed ${payload.committed} lead(s) to the pipeline${payload.tasks_created ? ` and scheduled ${payload.tasks_created} X-date task(s)` : ''}${payload.blocked_no_contact ? ` — ${payload.blocked_no_contact} blocked (no contact info; add a phone or email to commit them)` : ''}${payload.failed ? ` — ${payload.failed} failed` : ''}.`,
      );
      await loadBatches();
      await openBatch(activeBatch.id);
    } catch {
      setError('Commit failed.');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleRepair = async (): Promise<void> => {
    setIsRepairing(true);
    setError(null);
    try {
      const res = await fetch('/api/import/repair', { method: 'POST' });
      const payload = (await res.json().catch(() => ({}))) as {
        repaired?: number;
        skipped?: number;
        message?: string;
      };
      if (!res.ok) {
        setError(payload.message ?? 'Repair failed.');
        return;
      }
      setNotice(`Repaired ${payload.repaired ?? 0} legacy imported lead(s); ${payload.skipped ?? 0} already fine.`);
    } catch {
      setError('Repair failed.');
    } finally {
      setIsRepairing(false);
    }
  };

  const handleReparse = async (): Promise<void> => {
    if (!activeBatch) return;
    setError(null);
    try {
      const res = await fetch(`/api/import/${encodeURIComponent(activeBatch.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reparse' }),
      });
      const payload = (await res.json().catch(() => ({}))) as { reparsed?: number; message?: string };
      if (!res.ok) {
        setError(payload.message ?? 'Re-parse failed.');
        return;
      }
      setNotice(`Re-parsed ${payload.reparsed ?? 0} prospect(s) with the latest extraction rules.`);
      await openBatch(activeBatch.id);
    } catch {
      setError('Re-parse failed.');
    }
  };

  const handleRestore = async (): Promise<void> => {
    if (!activeBatch) return;
    setError(null);
    try {
      const res = await fetch(`/api/import/${encodeURIComponent(activeBatch.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore' }),
      });
      if (!res.ok) {
        setError('Restore failed.');
        return;
      }
      setNotice('Skipped and duplicate prospects restored to review.');
      await loadBatches();
      await openBatch(activeBatch.id);
    } catch {
      setError('Restore failed.');
    }
  };

  const saveEdit = async (): Promise<void> => {
    if (!activeBatch || !editing) return;
    setIsSavingEdit(true);
    setError(null);
    try {
      const res = await fetch(`/api/import/${encodeURIComponent(activeBatch.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', ...editing }),
      });
      if (!res.ok) {
        setError('Failed to save prospect.');
        return;
      }
      setEditing(null);
      await openBatch(activeBatch.id);
    } catch {
      setError('Failed to save prospect.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const toggleIncluded = (id: string): void => {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const extractedSummary = (row: StagedProspectRow): string => {
    const profile = row.payload?.profile;
    if (!profile) return '--';
    if (profile.kind === 'commercial') {
      const parts: string[] = [];
      if (profile.contacts?.length) parts.push(`${profile.contacts.length} contact(s)`);
      if (profile.renewals?.length) parts.push(`${profile.renewals.length} X-date(s)`);
      return parts.join(' · ') || 'Company record';
    }
    if (profile.kind === 'personal_auto') {
      const vehicle = profile.vehicles?.[0];
      const parts: string[] = [];
      if (vehicle) parts.push([vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' '));
      if (profile.current_carrier) parts.push(`w/ ${profile.current_carrier}`);
      return parts.join(' · ') || 'Applicant record';
    }
    return '--';
  };

  const pendingCount = prospects.filter((row) => row.disposition === 'pending').length;
  const restorableCount = prospects.filter((row) => row.disposition === 'skipped' || row.disposition === 'duplicate').length;
  const reviewable = pendingCount > 0;

  return (
    <SectionLayout title="Import Center">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#5c6873]">
          Upload vendor lead files. Prospects stage here for review before entering the pipeline.
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowNewLead(true)}
            className="rounded border border-[#c8ced3] bg-white px-3 py-2 text-xs font-semibold text-[#5c6873] hover:bg-[#f0f3f5]"
          >
            + New Lead
          </button>
          <button
            type="button"
            onClick={() => setShowDuplicates(true)}
            className="rounded border border-[#c8ced3] bg-white px-3 py-2 text-xs font-semibold text-[#5c6873] hover:bg-[#f0f3f5]"
          >
            Duplicates
          </button>
          <button
            type="button"
            onClick={() => void handleRepair()}
            disabled={isRepairing}
            className="inline-flex items-center gap-1.5 rounded border border-[#c8ced3] bg-white px-3 py-2 text-xs font-semibold text-[#5c6873] hover:bg-[#f0f3f5] disabled:opacity-60"
            title="Re-parse previously imported leads to recover names, emails, and phones"
          >
            <Wrench className="h-3.5 w-3.5" />
            {isRepairing ? 'Repairing…' : 'Repair legacy imports'}
          </button>
          <Link href="/leads" className="rounded border border-[#1b8eb7] bg-[#20a8d8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1b8eb7]">
            Back to pipeline
          </Link>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="mb-3 rounded border border-[#4dbd74]/40 bg-[#4dbd74]/10 px-3 py-2 text-sm text-green-800">{notice}</div> : null}

      {/* Upload zone */}
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleUpload(file);
        }}
        className={`mb-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded border-2 border-dashed px-6 py-8 text-center transition ${
          isDragOver ? 'border-[#20a8d8] bg-[#20a8d8]/10' : 'border-[#c8ced3] bg-white hover:border-[#20a8d8]/60'
        }`}
      >
        <FileUp className="h-8 w-8 text-[#20a8d8]" />
        <p className="text-sm font-semibold text-[#23282c]">
          {isUploading ? 'Parsing file…' : 'Drop a CSV or Excel lead file here, or click to browse'}
        </p>
        <p className="text-xs text-[#73818f]">
          Commercial prospect files (grouped by company, X-dates extracted) and personal auto lead files (vehicles, compliance) are detected automatically.
        </p>
        <input
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          disabled={isUploading}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
            event.target.value = '';
          }}
        />
      </label>

      {/* Active batch review */}
      {activeBatch ? (
        <div className="mb-5 rounded border border-[#c8ced3] bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-[#f0f3f5] bg-[#f8f9fa] px-4 py-2.5">
            <Users className="h-4 w-4 text-[#20a8d8]" />
            <p className="text-sm font-bold text-[#23282c]">{activeBatch.file_name}</p>
            <span className="rounded bg-[#20a8d8]/15 px-2 py-0.5 text-[11px] font-bold uppercase text-[#167495]">
              {PROFILE_LABELS[activeBatch.vendor_profile] ?? activeBatch.vendor_profile}
            </span>
            {activeBatch.vendor_profile === 'generic' ? (
              <span className="rounded bg-[#ffc107]/25 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-800" title="Unrecognized layout: basic fields mapped, everything else preserved in Additional Data">
                Partial mapping
              </span>
            ) : null}
            <p className="text-xs text-[#73818f]">
              {activeBatch.row_count} rows → {activeBatch.prospect_count} prospects · {activeBatch.duplicate_count} duplicate(s)
            </p>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleReparse()}
                className="rounded border border-[#c8ced3] bg-white px-3 py-1.5 text-xs font-bold text-[#5c6873] hover:bg-[#f0f3f5]"
                title="Re-run the latest extraction rules over this batch"
              >
                Re-parse
              </button>
              {restorableCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void handleRestore()}
                  className="rounded border border-[#c8ced3] bg-white px-3 py-1.5 text-xs font-bold text-[#5c6873] hover:bg-[#f0f3f5]"
                >
                  Restore {restorableCount} skipped
                </button>
              ) : null}
              {reviewable ? (
                <button
                  type="button"
                  onClick={() => void handleCommit()}
                  disabled={isCommitting || included.size === 0}
                  className="inline-flex items-center gap-1.5 rounded bg-[#4dbd74] px-3 py-1.5 text-xs font-bold text-white hover:brightness-95 disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {isCommitting ? 'Committing…' : `Commit ${included.size} to pipeline`}
                </button>
              ) : (
                <span className="rounded bg-[#4dbd74]/15 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                  Committed {activeBatch.committed_count}
                </span>
              )}
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 border-b border-[#e1e6ea] bg-[#f8f9fa] text-xs uppercase tracking-wide text-[#73818f]">
                <tr>
                  {reviewable ? <th className="w-10 px-4 py-2" /> : null}
                  <th className="px-4 py-2 font-bold">Prospect</th>
                  <th className="px-4 py-2 font-bold">Contact</th>
                  <th className="px-4 py-2 font-bold">Extracted</th>
                  <th className="px-4 py-2 font-bold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f3f5]">
                {prospects.map((row) => {
                  const hasContact = Boolean(row.email?.trim() || row.phone?.trim());
                  const isEditing = editing?.id === row.id;
                  return (
                    <tr key={row.id} className={row.disposition === 'duplicate' ? 'bg-[#ffc107]/5' : !hasContact ? 'bg-[#f86c6b]/5' : ''}>
                      {reviewable ? (
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={included.has(row.id)}
                            disabled={!hasContact}
                            onChange={() => toggleIncluded(row.id)}
                            className="h-4 w-4 cursor-pointer accent-[#20a8d8] disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Include ${row.full_name}`}
                            title={hasContact ? '' : 'Add a phone or email before committing'}
                          />
                        </td>
                      ) : null}
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editing.full_name}
                            onChange={(event) => setEditing((prev) => (prev ? { ...prev, full_name: event.target.value } : prev))}
                            className="w-full rounded border border-[#c8ced3] px-2 py-1 text-sm"
                          />
                        ) : (
                          <>
                            <p className="font-semibold text-[#23282c]">{row.full_name}</p>
                            <p className="text-xs text-[#73818f]">{row.line_of_business ?? '--'}</p>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        {isEditing ? (
                          <div className="flex flex-col gap-1">
                            <input
                              type="tel"
                              value={editing.phone}
                              onChange={(event) => setEditing((prev) => (prev ? { ...prev, phone: event.target.value } : prev))}
                              placeholder="Phone"
                              className="rounded border border-[#c8ced3] px-2 py-1 text-xs"
                            />
                            <input
                              type="email"
                              value={editing.email}
                              onChange={(event) => setEditing((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                              placeholder="Email"
                              className="rounded border border-[#c8ced3] px-2 py-1 text-xs"
                            />
                          </div>
                        ) : (
                          <>
                            <p className="text-[#23282c]">{row.phone ?? '--'}</p>
                            <p className="max-w-56 truncate text-xs text-[#73818f]">{row.email ?? '--'}</p>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-2 text-xs text-[#5c6873]">{extractedSummary(row)}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {!hasContact && row.disposition === 'pending' ? (
                            <span className="rounded bg-[#f86c6b] px-2 py-0.5 text-[11px] font-bold uppercase text-white">No contact</span>
                          ) : row.disposition === 'duplicate' ? (
                            <span className="rounded bg-[#ffc107]/25 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-800" title={row.duplicate_of ?? ''}>
                              Duplicate ({row.duplicate_of?.split(':')[0] ?? ''})
                            </span>
                          ) : row.disposition === 'committed' ? (
                            <span className="rounded bg-[#4dbd74]/20 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">Committed</span>
                          ) : row.disposition === 'skipped' ? (
                            <span className="rounded bg-[#f0f3f5] px-2 py-0.5 text-[11px] font-bold uppercase text-[#73818f]">Skipped</span>
                          ) : (
                            <span className="rounded bg-[#63c2de]/20 px-2 py-0.5 text-[11px] font-bold uppercase text-[#167495]">Ready</span>
                          )}
                          {row.disposition !== 'committed' ? (
                            isEditing ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void saveEdit()}
                                  disabled={isSavingEdit}
                                  className="text-xs font-bold text-[#4dbd74] hover:underline disabled:opacity-50"
                                >
                                  {isSavingEdit ? 'Saving…' : 'Save'}
                                </button>
                                <button type="button" onClick={() => setEditing(null)} className="text-xs font-semibold text-[#73818f] hover:underline">
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setEditing({ id: row.id, full_name: row.full_name, email: row.email ?? '', phone: row.phone ?? '' })}
                                className="text-xs font-semibold text-[#167495] hover:underline"
                              >
                                Edit
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Batch history */}
      <div className="rounded border border-[#c8ced3] bg-white shadow-sm">
        <div className="border-b border-[#f0f3f5] bg-[#f8f9fa] px-4 py-2.5 text-sm font-bold text-[#23282c]">
          Import History
        </div>
        {batches.length === 0 ? (
          <p className="p-4 text-sm text-[#73818f]">No imports yet.</p>
        ) : (
          <ul className="divide-y divide-[#f0f3f5]">
            {batches.map((batch) => (
              <li key={batch.id}>
                <button
                  type="button"
                  onClick={() => void openBatch(batch.id)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-[#f0f3f5]/70 ${
                    activeBatch?.id === batch.id ? 'bg-[#20a8d8]/5' : ''
                  }`}
                >
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-[#167495]">{batch.file_name}</p>
                  <span className="shrink-0 rounded bg-[#f0f3f5] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#73818f]">
                    {PROFILE_LABELS[batch.vendor_profile] ?? batch.vendor_profile}
                  </span>
                  <span className="shrink-0 text-xs text-[#73818f]">
                    {batch.prospect_count} prospects · {batch.status}
                  </span>
                  <span className="shrink-0 text-xs text-[#73818f]">{prettyDate(batch.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {showDuplicates ? (
        <DuplicatesModal onClose={() => setShowDuplicates(false)} onMerged={() => undefined} />
      ) : null}

      {showNewLead ? (
        <NewLeadModal
          onClose={() => setShowNewLead(false)}
          onCreated={() => {
            setShowNewLead(false);
            setNotice('Lead created and added to the pipeline with a contact task.');
          }}
        />
      ) : null}
    </SectionLayout>
  );
}
