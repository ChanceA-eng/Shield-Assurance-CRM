'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  buildDefaultSheetRecord,
  buildSheetSummary,
  computeSheetFormulaValue,
  createBlankSheetRow,
  createSheetColumnKey,
  type CustomSheetRecord,
  type CustomSheetSummary,
  type SheetCellValue,
  type SheetColumn,
  type SheetColumnType,
  type SheetRow,
} from '../../lib/rashi-sheets';

function formatMoney(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function getCellInputType(column: SheetColumn): 'text' | 'number' | 'url' {
  if (column.type === 'number' || column.type === 'currency') {
    return 'number';
  }

  if (column.type === 'url') {
    return 'url';
  }

  return 'text';
}

export default function RashiSheetWorkspace(): JSX.Element {
  const [sheets, setSheets] = useState<CustomSheetSummary[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(null);
  const [activeSheet, setActiveSheet] = useState<CustomSheetRecord | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newColumnLabel, setNewColumnLabel] = useState('');
  const [newColumnType, setNewColumnType] = useState<SheetColumnType>('text');

  const groupedSheets = useMemo(() => {
    return sheets.reduce<Record<string, CustomSheetSummary[]>>((accumulator, sheet) => {
      const bucket = accumulator[sheet.category] ?? [];
      bucket.push(sheet);
      accumulator[sheet.category] = bucket;
      return accumulator;
    }, {});
  }, [sheets]);

  const grandTotal = useMemo(() => {
    if (!activeSheet) {
      return 0;
    }

    return activeSheet.rows.reduce((sum, row) => {
      const formulaColumn = activeSheet.columns.find((column) => column.formula === 'line_total');
      if (!formulaColumn) {
        return sum;
      }

      return sum + computeSheetFormulaValue(row, formulaColumn);
    }, 0);
  }, [activeSheet]);

  const loadSheet = async (sheetId: string): Promise<void> => {
    setLoadingSheet(true);
    setError(null);

    const response = await fetch(`/api/rashi/sheets/${sheetId}`, { cache: 'no-store' });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to load sheet.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to load sheet.');
      setLoadingSheet(false);
      return;
    }

    const payload = (await response.json()) as CustomSheetRecord;
    setActiveSheet(payload);
    setLoadingSheet(false);
  };

  const loadSheets = async (preferredSheetId?: string): Promise<void> => {
    setLoadingList(true);
    setError(null);

    const response = await fetch('/api/rashi/sheets', { cache: 'no-store' });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to load sheets.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to load sheets.');
      setLoadingList(false);
      return;
    }

    const payload = (await response.json()) as CustomSheetSummary[];
    setSheets(payload);
    setLoadingList(false);

    const targetSheetId = preferredSheetId ?? activeSheetId ?? payload[0]?.id ?? null;
    if (targetSheetId) {
      setActiveSheetId(targetSheetId);
      await loadSheet(targetSheetId);
    } else {
      setActiveSheetId(null);
      setActiveSheet(null);
    }
  };

  useEffect(() => {
    void loadSheets();
  }, []);

  const replaceSummary = (sheet: CustomSheetRecord): void => {
    const summary = buildSheetSummary(sheet);
    setSheets((current) => {
      const next = current.filter((entry) => entry.id !== summary.id);
      return [summary, ...next].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    });
  };

  const handleCreateSheet = async (): Promise<void> => {
    setCreating(true);
    setError(null);
    setNotice(null);

    const response = await fetch('/api/rashi/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildDefaultSheetRecord()),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to create sheet.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create sheet.');
      setCreating(false);
      return;
    }

    const payload = (await response.json()) as CustomSheetRecord;
    setActiveSheetId(payload.id);
    setActiveSheet(payload);
    replaceSummary(payload);
    setCreating(false);
    setNotice('Blank sheet created.');
  };

  const handleAddColumn = (): void => {
    if (!activeSheet) {
      return;
    }

    const trimmed = newColumnLabel.trim();
    if (!trimmed) {
      setError('Enter a column name first.');
      return;
    }

    let key = createSheetColumnKey(trimmed);
    let suffix = 2;
    while (activeSheet.columns.some((column) => column.key === key)) {
      key = `${createSheetColumnKey(trimmed)}_${suffix}`;
      suffix += 1;
    }

    const column: SheetColumn = { key, label: trimmed, type: newColumnType };
    setActiveSheet({
      ...activeSheet,
      columns: [...activeSheet.columns, column],
      rows: activeSheet.rows.map((row) => ({ ...row, [key]: '' })),
    });
    setNewColumnLabel('');
    setNewColumnType('text');
    setNotice(null);
  };

  const handleAddRow = (): void => {
    if (!activeSheet) {
      return;
    }

    setActiveSheet({
      ...activeSheet,
      rows: [...activeSheet.rows, createBlankSheetRow(activeSheet.columns)],
    });
    setNotice(null);
  };

  const handleUpdateCell = (rowId: string, key: string, value: SheetCellValue): void => {
    if (!activeSheet) {
      return;
    }

    setActiveSheet({
      ...activeSheet,
      rows: activeSheet.rows.map((row) => (row.id === rowId ? { ...row, [key]: value } : row)),
    });
    setNotice(null);
  };

  const handleUpdateColumn = (key: string, patch: Partial<SheetColumn>): void => {
    if (!activeSheet) {
      return;
    }

    setActiveSheet({
      ...activeSheet,
      columns: activeSheet.columns.map((column) => (column.key === key ? { ...column, ...patch } : column)),
    });
    setNotice(null);
  };

  const handleSaveSheet = async (): Promise<void> => {
    if (!activeSheet) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    const response = await fetch(`/api/rashi/sheets/${activeSheet.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: activeSheet.title,
        category: activeSheet.category,
        columns: activeSheet.columns,
        rows: activeSheet.rows,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to save sheet.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to save sheet.');
      setSaving(false);
      return;
    }

    const payload = (await response.json()) as CustomSheetRecord;
    setActiveSheet(payload);
    replaceSummary(payload);
    setSaving(false);
    setNotice('Sheet saved.');
  };

  return (
    <section className="rounded-2xl border border-[#c8ced3] bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-[#e2e8f0] pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#167495]">Knowledge Sheets</p>
          <h3 className="mt-1 text-xl font-semibold text-[#081a30]">Interactive ledgers inside the Knowledge Center</h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[#475569]">
            Build flexible expense boards, carrier login sheets, or freeform operating notes. Uploaded files stay in Supabase Storage,
            and these sheet layouts persist in your database as editable JSON grids.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleCreateSheet()}
          disabled={creating}
          className="rounded-xl bg-[#23282c] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#13335c] disabled:cursor-not-allowed disabled:bg-[#56708b]"
        >
          {creating ? 'Creating Sheet...' : 'Create Blank Sheet'}
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[260px_1fr]">
        <aside className="rounded-2xl border border-[#e2e8f0] bg-[#f8f9fa] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#73818f]">Directory</p>
          {loadingList ? <p className="mt-3 text-sm text-[#73818f]">Loading sheets...</p> : null}
          {!loadingList && sheets.length === 0 ? (
            <p className="mt-3 text-sm text-[#73818f]">No sheets yet. Create one to start a ledger or note grid.</p>
          ) : null}
          <div className="mt-3 space-y-4">
            {Object.entries(groupedSheets)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([category, entries]) => (
                <div key={category}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94a3b8]">{category}</p>
                  <div className="mt-2 space-y-2">
                    {entries.map((sheet) => (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => {
                          setActiveSheetId(sheet.id);
                          void loadSheet(sheet.id);
                        }}
                        className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                          activeSheetId === sheet.id
                            ? 'border-[#20a8d8] bg-white shadow-sm'
                            : 'border-transparent bg-white/60 hover:border-[#cbd5e1]'
                        }`}
                      >
                        <p className="truncate text-sm font-semibold text-[#081a30]">{sheet.title}</p>
                        <p className="mt-1 text-xs text-[#73818f]">{sheet.rowCount} rows · {sheet.columnCount} columns</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </aside>

        <div className="rounded-2xl border border-[#e2e8f0] bg-[#fcfdff] p-4">
          {loadingSheet ? <p className="text-sm text-[#73818f]">Loading selected sheet...</p> : null}

          {!loadingSheet && !activeSheet ? (
            <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-white p-6 text-sm text-[#475569]">
              Create a blank sheet to start a live ledger inside the Knowledge Center.
            </div>
          ) : null}

          {!loadingSheet && activeSheet ? (
            <div className="space-y-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="grid flex-1 gap-3 md:grid-cols-[1.4fr_0.7fr]">
                  <label className="text-sm font-medium text-[#334155]">
                    Title
                    <input
                      type="text"
                      value={activeSheet.title}
                      onChange={(event) => setActiveSheet({ ...activeSheet, title: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-[#c8ced3] bg-white px-3 py-2.5 text-sm"
                    />
                  </label>
                  <label className="text-sm font-medium text-[#334155]">
                    Category
                    <input
                      type="text"
                      value={activeSheet.category}
                      onChange={(event) => setActiveSheet({ ...activeSheet, category: event.target.value })}
                      className="mt-1 w-full rounded-xl border border-[#c8ced3] bg-white px-3 py-2.5 text-sm"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleAddRow}
                    className="rounded-xl border border-[#cbd5e1] bg-white px-3 py-2 text-sm font-semibold text-[#23282c] transition hover:border-[#94a3b8]"
                  >
                    Add Row
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveSheet()}
                    disabled={saving}
                    className="rounded-xl bg-[#20a8d8] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#1b8eb7] disabled:cursor-not-allowed disabled:bg-[#8eb9df]"
                  >
                    {saving ? 'Saving...' : 'Save Sheet'}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 rounded-2xl border border-[#e2e8f0] bg-white p-4 md:grid-cols-[1.2fr_180px_auto]">
                <input
                  type="text"
                  value={newColumnLabel}
                  onChange={(event) => setNewColumnLabel(event.target.value)}
                  placeholder="New column name"
                  className="rounded-xl border border-[#c8ced3] px-3 py-2.5 text-sm"
                />
                <select
                  value={newColumnType}
                  onChange={(event) => setNewColumnType(event.target.value as SheetColumnType)}
                  className="rounded-xl border border-[#c8ced3] px-3 py-2.5 text-sm"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="url">URL</option>
                </select>
                <button
                  type="button"
                  onClick={handleAddColumn}
                  className="rounded-xl border border-[#167495] bg-[#f6fbff] px-3 py-2.5 text-sm font-semibold text-[#167495] transition hover:bg-[#eaf4fd]"
                >
                  Add Column
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-[#d8e6f6] bg-[#f6fbff] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#73818f]">Rows</p>
                  <p className="mt-1 text-2xl font-bold text-[#081a30]">{activeSheet.rows.length}</p>
                </div>
                <div className="rounded-2xl border border-[#d8e6f6] bg-[#f6fbff] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#73818f]">Columns</p>
                  <p className="mt-1 text-2xl font-bold text-[#081a30]">{activeSheet.columns.length}</p>
                </div>
                <div className="rounded-2xl border border-[#d8e6f6] bg-[#f6fbff] p-4">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#73818f]">Grand Total</p>
                  <p className="mt-1 text-2xl font-bold text-[#081a30]">{formatMoney(grandTotal)}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-[#e2e8f0] bg-white">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-[#f8fafc] align-top">
                    <tr>
                      {activeSheet.columns.map((column) => (
                        <th key={column.key} className="min-w-[180px] border-b border-r border-[#e2e8f0] px-3 py-3 text-left font-medium last:border-r-0">
                          <input
                            type="text"
                            value={column.label}
                            onChange={(event) => handleUpdateColumn(column.key, { label: event.target.value })}
                            className="w-full rounded-lg border border-[#cbd5e1] bg-white px-2 py-1.5 text-sm font-semibold text-[#081a30]"
                          />
                          {column.formula ? (
                            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#167495]">Auto: Unit Cost × Quantity</p>
                          ) : (
                            <select
                              value={column.type}
                              onChange={(event) => handleUpdateColumn(column.key, { type: event.target.value as SheetColumnType })}
                              className="mt-2 w-full rounded-lg border border-[#cbd5e1] bg-white px-2 py-1.5 text-xs text-[#334155]"
                            >
                              <option value="text">Text</option>
                              <option value="number">Number</option>
                              <option value="currency">Currency</option>
                              <option value="url">URL</option>
                            </select>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeSheet.rows.map((row) => (
                      <tr key={row.id}>
                        {activeSheet.columns.map((column) => (
                          <td key={`${row.id}-${column.key}`} className="border-b border-r border-[#e2e8f0] px-3 py-2 align-top last:border-r-0">
                            {column.formula ? (
                              <div className="rounded-lg border border-dashed border-[#cbd5e1] bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#23282c]">
                                {formatMoney(computeSheetFormulaValue(row, column))}
                              </div>
                            ) : (
                              <input
                                type={getCellInputType(column)}
                                inputMode={column.type === 'number' || column.type === 'currency' ? 'decimal' : undefined}
                                step={column.type === 'number' || column.type === 'currency' ? '0.01' : undefined}
                                value={typeof row[column.key] === 'number' ? String(row[column.key]) : (row[column.key] ?? '')}
                                onChange={(event) => handleUpdateCell(row.id, column.key, event.target.value)}
                                className="w-full rounded-lg border border-transparent bg-transparent px-2 py-2 text-sm text-[#0f172a] outline-none transition focus:border-[#93c5fd] focus:bg-[#f8f9fa]"
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-xs leading-5 text-[#73818f]">
                Formula columns stay read-only. The default line total column multiplies the Unit Cost and Quantity keys, while all other columns remain open-ended for notes, URLs, credentials, and tracking fields.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
      {notice ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
    </section>
  );
}