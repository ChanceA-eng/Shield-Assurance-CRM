'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSET_FIELDS, ASSET_LABELS, ASSET_SOURCE_LABELS, isAssetKind, isAssetSource, type AssetDetails, type AssetKind, type AssetSource, type RecordTarget, type WorkspaceAsset } from '@crm/shared';
import { formatArizonaDateTime } from '../../lib/arizona-time';
import { isRecord, validateAsset } from '../../lib/workspace-validation';
import { workspaceFetch, workspacePages } from '../../lib/workspace-fetch';
import RecordHistory from './RecordHistory';

interface Props {
  target: RecordTarget;
  composeToken?: number;
  refreshToken?: number;
  onChanged: () => void;
}

interface AssetForm {
  title: string;
  asset_type: AssetKind;
  source: AssetSource;
  details: AssetDetails;
  source_reference: string;
}

function emptyForm(): AssetForm {
  return { title: '', asset_type: 'vehicle', source: 'client_reported', details: {}, source_reference: '' };
}

function detailsOf(asset: WorkspaceAsset): AssetDetails {
  if (!isAssetKind(asset.asset_type) || !isRecord(asset.metadata.details)) return {};
  const details: AssetDetails = {};
  for (const field of [...ASSET_FIELDS[asset.asset_type], { key: 'notes' as const, label: 'Notes' }]) {
    const value = asset.metadata.details[field.key];
    if (typeof value === 'string') details[field.key] = value;
  }
  return details;
}

export default function RecordAssetsPanel({ target, composeToken = 0, refreshToken = 0, onChanged }: Props): JSX.Element {
  const [assets, setAssets] = useState<WorkspaceAsset[]>([]);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<AssetForm>(emptyForm);
  const [editing, setEditing] = useState<WorkspaceAsset | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveId = useRef<string | null>(null);
  const draftsByType = useRef<Partial<Record<AssetKind, AssetDetails>>>({});
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const loadVersion = useRef(0);
  const endpoint = `/api/record-assets?record_type=${target.type}&record_id=${target.id}`;

  const load = useCallback(async (): Promise<void> => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const rows = await workspacePages<WorkspaceAsset>(`${endpoint}&archived=${archived}`, 100, 'page');
      if (version !== loadVersion.current) return;
      setAssets(rows);
      setError(null);
    } catch (failure) {
      if (version === loadVersion.current) setError(failure instanceof Error ? failure.message : 'Unable to load assets.');
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [endpoint, archived]);

  useEffect(() => { void load(); }, [load, refreshToken]);
  useEffect(() => {
    if (composeToken > 0) {
      if (editingRef.current) setNotice('Finish or cancel this edit before adding another asset.');
      else setFormOpen(true);
    }
  }, [composeToken]);

  const edit = (asset: WorkspaceAsset): void => {
    setEditing(asset);
    setForm({
      title: asset.title, asset_type: isAssetKind(asset.asset_type) ? asset.asset_type : 'general',
      source: isAssetSource(asset.metadata.source) ? asset.metadata.source : 'client_reported',
      details: detailsOf(asset),
      source_reference: typeof asset.metadata.source_reference === 'string' ? asset.metadata.source_reference : '',
    });
    setFormOpen(true);
    setNotice(null);
  };

  const closeForm = (): void => {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    draftsByType.current = {};
    saveId.current = null;
  };

  const save = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const validated = validateAsset(form);
    if (typeof validated === 'string') { setError(validated); return; }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      saveId.current ??= crypto.randomUUID();
      await workspaceFetch<WorkspaceAsset>(endpoint, {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...validated, id: editing?.id ?? saveId.current, expected_updated_at: editing?.updated_at,
        }),
      });
      closeForm();
      setNotice('Asset saved. This records the asset only; coverage has not been changed.');
      await load();
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to save this asset.');
    } finally {
      setSaving(false);
    }
  };

  const archive = async (asset: WorkspaceAsset): Promise<void> => {
    setSaving(true);
    setNotice(null);
    try {
      await workspaceFetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: asset.id, action: archived ? 'restore' : 'archive', expected_updated_at: asset.updated_at }),
      });
      await load();
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Unable to change asset status.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-cui-text">Assets &amp; drivers</h3>
          <p className="text-xs text-cui-muted">Record each vehicle, property, location or driver separately. Unknown details can be added later.</p>
        </div>
        <button type="button" disabled={saving || Boolean(editing)} onClick={() => setFormOpen(true)} className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
          Add asset
        </button>
      </div>
      <p className="rounded border border-cui-warning/40 bg-cui-warning/10 px-3 py-2 text-xs text-cui-text">
        Inventory is not an insured schedule. Adding, editing or archiving an asset does not bind coverage or process a carrier endorsement.
      </p>
      {error ? <div role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 p-3 text-sm text-cui-danger">{error} <button type="button" onClick={() => void load()} className="font-semibold underline">Refresh</button></div> : null}
      {notice ? <p role="status" className="rounded bg-cui-success/10 p-3 text-sm text-cui-text">{notice}</p> : null}

      {formOpen ? (
        <form onSubmit={(event) => void save(event)} className="space-y-3 rounded border border-cui-border bg-white p-3">
          <h4 className="font-semibold text-cui-text">{editing ? 'Edit asset' : 'Add an asset'}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-cui-muted">Asset type
              <select value={form.asset_type} disabled={Boolean(editing)} onChange={(event) => {
                const kind = event.target.value;
                if (isAssetKind(kind)) setForm((previous) => {
                  draftsByType.current[previous.asset_type] = previous.details;
                  return { ...previous, asset_type: kind, details: draftsByType.current[kind] ?? {} };
                });
              }} className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text">
                {Object.entries(ASSET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-cui-muted">Name / label
              <input required maxLength={200} autoFocus value={form.title} onChange={(event) => setForm((previous) => ({ ...previous, title: event.target.value }))}
                placeholder="Truck 1, rental home, main shop..." className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
            </label>
            {ASSET_FIELDS[form.asset_type].map((field) => (
              <label key={field.key} className="text-xs font-semibold text-cui-muted">{field.label}
                <input value={form.details[field.key] ?? ''} placeholder={field.placeholder} maxLength={4000}
                  onChange={(event) => setForm((previous) => ({ ...previous, details: { ...previous.details, [field.key]: event.target.value } }))}
                  className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
              </label>
            ))}
            <label className="text-xs font-semibold text-cui-muted">Information source
              <select value={form.source} onChange={(event) => {
                const source = event.target.value;
                if (isAssetSource(source)) setForm((previous) => ({ ...previous, source }));
              }} className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text">
                {Object.entries(ASSET_SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold text-cui-muted">Source / verification reference
              <input value={form.source_reference} onChange={(event) => setForm((previous) => ({ ...previous, source_reference: event.target.value }))}
                placeholder="Call, submission ID, import file or record URL" maxLength={2000} className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
            </label>
            <label className="text-xs font-semibold text-cui-muted sm:col-span-2">Additional details / missing information
              <textarea value={form.details.notes ?? ''} maxLength={4000} onChange={(event) => setForm((previous) => ({ ...previous, details: { ...previous.details, notes: event.target.value } }))}
                className="mt-1 min-h-16 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
            </label>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving...' : 'Save asset'}</button>
            <button type="button" disabled={saving} onClick={closeForm} className="rounded border border-cui-border px-3 py-1.5 text-sm text-cui-muted">Cancel</button>
          </div>
        </form>
      ) : null}

      <div className="flex gap-1 border-b border-cui-border">
        {[false, true].map((value) => (
          <button key={String(value)} type="button" onClick={() => setArchived(value)} className={`border-b-2 px-3 py-1.5 text-sm font-semibold ${archived === value ? 'border-cui-primary text-cui-primary' : 'border-transparent text-cui-muted'}`}>
            {value ? 'Archived' : 'Current'}
          </button>
        ))}
      </div>
      {loading ? <p className="text-sm text-cui-muted">Loading assets...</p> : !assets.length && !error ? <p className="text-sm text-cui-muted">{archived ? 'No archived assets.' : 'No assets recorded yet.'}</p> : null}
      {assets.map((asset) => {
        const details = detailsOf(asset);
        const kind = isAssetKind(asset.asset_type) ? asset.asset_type : null;
        const source = isAssetSource(asset.metadata.source) ? ASSET_SOURCE_LABELS[asset.metadata.source] : 'Source not recorded';
        return (
          <article key={asset.id} className="rounded border border-cui-border bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div><h4 className="font-semibold text-cui-text">{asset.title}</h4><p className="text-xs text-cui-muted">{kind ? ASSET_LABELS[kind] : asset.asset_type} | {source}</p></div>
              <div className="flex gap-2 text-xs font-semibold">
                {!archived ? <button type="button" disabled={saving} onClick={() => edit(asset)} className="text-cui-primary">Edit</button> : null}
                <button type="button" disabled={saving} onClick={() => void archive(asset)} className="text-cui-primary disabled:opacity-50">{archived ? 'Restore' : 'Archive'}</button>
              </div>
            </div>
            <dl className="mt-2 grid gap-x-3 gap-y-1 text-sm sm:grid-cols-2">
              {kind ? ASSET_FIELDS[kind].filter((field) => details[field.key]).map((field) => (
                <div key={field.key}><dt className="inline font-semibold text-cui-muted">{field.label}: </dt><dd className="inline break-words text-cui-text">{details[field.key]}</dd></div>
              )) : null}
            </dl>
            {details.notes ? <p className="mt-2 whitespace-pre-wrap text-sm text-cui-text">{details.notes}</p> : null}
            {typeof asset.metadata.source_reference === 'string' && asset.metadata.source_reference ? <p className="mt-1 break-words text-xs text-cui-muted">Reference: {asset.metadata.source_reference}</p> : null}
            {asset.value ? <p className="mt-2 whitespace-pre-wrap text-sm text-cui-text">Previously recorded details: {asset.value}</p> : null}
            {kind === 'vehicle' && (!details.vin || !details.address) ? <p className="mt-2 text-xs font-semibold text-amber-700">Still needed: {[!details.vin ? 'VIN' : null, !details.address ? 'garaging address' : null].filter(Boolean).join(', ')}</p> : null}
            {kind === 'property' && !details.address ? <p className="mt-2 text-xs font-semibold text-amber-700">Still needed: property address</p> : null}
            <p className="mt-2 text-[11px] text-cui-muted">Updated {formatArizonaDateTime(asset.updated_at)} AZ{asset.updated_by || asset.created_by ? ` by ${asset.updated_by || asset.created_by}` : ''}</p>
            <RecordHistory target={target} itemId={asset.id} table="client_assets" />
          </article>
        );
      })}
    </div>
  );
}
