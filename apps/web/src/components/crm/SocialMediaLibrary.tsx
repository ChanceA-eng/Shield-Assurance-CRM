'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SOCIAL_IMAGE_MAX_BYTES, type SocialMediaAsset, type SocialMediaList } from '@crm/shared';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { ImageIcon, Upload, X } from 'lucide-react';

const endpoint = '/api/social-marketing/media';
const buttonClass = 'rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary disabled:opacity-50';

export function SocialImagePreview({ id, alt, thumbnail = false, className }: { id: string; alt: string; thumbnail?: boolean; className?: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [id, thumbnail]);
  return failed ? <p role="alert" className="text-sm text-red-800">Image preview failed. <button type="button" className="underline" onClick={() => setFailed(false)}>Retry preview</button></p>
    : <img src={`${endpoint}?id=${id}&variant=${thumbnail ? 'thumbnail' : 'image'}`} alt={alt}
      className={className ?? 'max-h-64 max-w-full rounded-xl object-contain'} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

export default function SocialMediaLibrary({ selected, onSelect, disabled = false, canUpload = true, onBusyChange }: {
  selected?: string; onSelect?: (asset: SocialMediaAsset) => void; disabled?: boolean; canUpload?: boolean; onBusyChange?: (busy: boolean) => void;
}): JSX.Element {
  const [list, setList] = useState<SocialMediaList>({ assets: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [rights, setRights] = useState('');
  const [showUpload, setShowUpload] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const uploading = useRef(false);
  const load = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const result = await workspaceFetch<SocialMediaList>(`${endpoint}?offset=${offset}`);
      if (current === generation.current) { setList(result); setError(''); }
    } catch (failure) {
      if (current === generation.current) { setList({ assets: [], total: 0 }); setError(failure instanceof Error ? failure.message : 'Could not load media.'); }
    } finally { if (current === generation.current) setLoading(false); }
  }, [offset]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  async function upload(): Promise<void> {
    if (disabled || uploading.current) return;
    if (!file) { setError('Choose an image to upload.'); return; }
    if (!file.size || file.size > SOCIAL_IMAGE_MAX_BYTES) { setError('Choose one JPEG/PNG image of up to 4 MB.'); return; }
    uploading.current = true; setBusy(true); onBusyChange?.(true); setNotice(''); setError('');
    try {
      const form = new FormData();
      form.set('file', file); form.set('alt_text', alt); form.set('rights_reference', rights);
      const asset = await workspaceFetch<SocialMediaAsset>(endpoint, { method: 'POST', body: form });
      if (!asset || asset.status !== 'ready' || !asset.id) throw new Error('The image upload was not confirmed. Refresh media before retrying.');
      setFile(null); setAlt(''); setRights(''); if (fileInput.current) fileInput.current.value = '';
      setNotice('Image uploaded and ready.');
      setShowUpload(false);
      if (offset !== 0) setOffset(0); else await load();
      onSelect?.(asset);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not upload image.');
    } finally { uploading.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const locked = disabled || busy;
  function chooseFile(files: FileList | null): void {
    if (!files?.length) return;
    setNotice(''); setFile(null);
    if (files.length !== 1) { setError('Choose one JPEG/PNG image.'); return; }
    const chosen = files[0];
    if (!chosen || !chosen.size || chosen.size > SOCIAL_IMAGE_MAX_BYTES || !['image/jpeg', 'image/png'].includes(chosen.type)) {
      setError('Choose one JPEG/PNG image of up to 4 MB.');
      return;
    }
    setFile(chosen); setError('');
  }
  return <Card className="!rounded-2xl !border-slate-200/70 !shadow-none">
    <CardHeader className="flex-wrap !border-slate-100 !bg-white !px-5 !py-4 [&>h2]:text-base" actions={<>
      <button type="button" className={buttonClass} disabled={locked || loading} onClick={() => void load()}>Refresh media</button>
      {canUpload ? <button type="button" className="inline-flex items-center gap-2 rounded-xl bg-cui-primary px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-cui-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary disabled:opacity-50" aria-expanded={showUpload} disabled={locked} onClick={() => setShowUpload(!showUpload)}><Upload size={15} aria-hidden />Upload image</button> : null}
    </>}>Image library</CardHeader>
    <CardBody className="!p-5">
      {error ? <p role="alert" className="mb-3 rounded bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
      {notice ? <p role="status" className="mb-3 text-sm text-cui-success">{notice}</p> : null}
      {canUpload && showUpload ? <section aria-label="Upload an image" onKeyDown={(event) => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }} className="mb-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200/60">
      <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Upload an image</h3><button type="button" aria-label="Close image upload" className="rounded p-1 text-cui-muted hover:bg-white" disabled={locked} onClick={() => setShowUpload(false)}><X size={16} aria-hidden /></button></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label onDragOver={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
          onDragLeave={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
          onDrop={(event) => { event.preventDefault(); setDragging(false); if (!locked) chooseFile(event.dataTransfer.files); }}
          className={`relative flex min-h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed p-5 text-center text-sm font-semibold transition focus-within:ring-2 focus-within:ring-cui-primary/30 sm:col-span-2 ${dragging ? 'border-cui-primary bg-cui-primary/10' : 'border-slate-300 bg-white hover:border-cui-primary'}`}>
          <span className="rounded-xl bg-cui-primary/10 p-3"><Upload size={22} className="text-cui-primary" aria-hidden /></span>
          <span className="sr-only">Image file</span><span className="max-w-full break-all">{file ? file.name : 'Drop an image or browse files'}</span>
          <input ref={fileInput} aria-label="Image file" type="file" accept="image/jpeg,image/png" disabled={locked}
            className="sr-only" onChange={(event) => { chooseFile(event.target.files); event.target.value = ''; }} /><span className="text-xs font-normal text-cui-muted">JPEG or PNG, up to 4 MB</span></label>
        <label className="block text-sm font-semibold">Image alt text<input maxLength={1000} disabled={locked} value={alt}
          placeholder="Describe the image"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal outline-none focus:border-cui-primary focus:ring-2 focus:ring-cui-primary/10" onChange={(event) => setAlt(event.target.value)} /></label>
        <label className="block text-sm font-semibold">Usage rights/source<input maxLength={1000} disabled={locked} value={rights}
          placeholder="For example: agency-owned photo or licensed source"
          className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 font-normal outline-none focus:border-cui-primary focus:ring-2 focus:ring-cui-primary/10" onChange={(event) => setRights(event.target.value)} /></label>
      </div>
      <details className="mt-3 text-xs text-cui-muted"><summary className="cursor-pointer">Image processing and limits</summary><p className="mt-2">Maximum 20 megapixels. Images are converted to JPEG, metadata removed, and transparency flattened to white. Originals are not retained.</p></details>
      <button type="button" disabled={locked || !file || !alt.trim() || !rights.trim()} className="mt-4 rounded-xl bg-cui-primary px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-cui-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary disabled:opacity-50" onClick={() => void upload()}>
        {busy ? 'Processing image...' : 'Upload to library'}
      </button>
      </section> : null}
      {loading ? <p role="status" className="mt-4 text-sm text-cui-muted">Loading images...</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.assets.map((asset) => <article key={asset.id} className={`min-w-0 overflow-hidden rounded-2xl bg-white p-2 ring-1 transition ${selected === asset.id ? 'ring-cui-primary shadow-sm' : 'ring-slate-200/70 hover:shadow-md'}`}>
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl bg-slate-100">{asset.status === 'ready' ? <SocialImagePreview id={asset.id} alt={asset.alt_text} thumbnail className="h-full w-full object-contain" /> : <ImageIcon size={28} className="text-slate-300" aria-hidden />}</div>
          <div className="px-2 pb-2 pt-3">
          <p className="mt-2 break-words text-sm font-semibold">{asset.file_name}</p>
          <p className="text-xs text-cui-muted">{asset.status}{asset.status === 'ready' ? ` · ${asset.width} × ${asset.height}` : ''}</p>
          <p className="mt-1 break-words text-xs text-cui-muted">{asset.rights_reference}</p>
          {asset.error_message ? <p className="mt-1 text-sm text-red-800">{asset.error_message}</p> : null}
          {onSelect && asset.status === 'ready' ? <button type="button" disabled={locked || selected === asset.id} className={`${buttonClass} mt-2`} onClick={() => onSelect(asset)}>
            {selected === asset.id ? 'Selected image' : 'Use image'}
          </button> : null}
          </div>
        </article>)}
        {!list.assets.length && !error ? <div className="col-span-full flex flex-col items-center rounded-2xl bg-slate-50 px-5 py-16 text-center"><span className="mb-4 rounded-2xl bg-cui-primary/10 p-4"><ImageIcon size={28} strokeWidth={1.5} className="text-cui-primary" aria-hidden /></span><p className="text-sm font-semibold">Your image library</p><p className="mt-2 text-sm text-cui-muted">Upload an agency-owned or licensed image to use in your posts.</p></div> : null}
      </div>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-cui-muted">{list.total} images · 250 MB library limit</span>
        <div className="flex gap-2"><button type="button" className={buttonClass} disabled={locked || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 24))}>Previous images</button>
          <button type="button" className={buttonClass} disabled={locked || loading || offset + 24 >= list.total} onClick={() => setOffset(offset + 24)}>Next images</button></div>
      </div>
    </CardBody>
  </Card>;
}
