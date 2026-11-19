'use client';

import { useEffect, useRef, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';

export default function EmailImageUpload({ onUploaded, endpoint = '/api/sales-templates/banner', onBusy, label = 'Upload image' }: {
  onUploaded: (url: string) => void; endpoint?: string; onBusy?: (busy: boolean) => void; label?: string;
}): JSX.Element {
  const [source, setSource] = useState('');
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50), [y, setY] = useState(50);
  const [ratio, setRatio] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  return <div className="space-y-2">
    <label className="block text-xs font-semibold">{label}
      <input type="file" accept="image/jpeg,image/png" disabled={busy} className="crm-input mt-1" onChange={(event) => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        if (!['image/jpeg', 'image/png'].includes(file.type) || !file.size || file.size > 4 * 1024 * 1024) {
          setError('Choose a JPEG or PNG up to 4 MB.'); return;
        }
        setSource(URL.createObjectURL(file)); setZoom(1); setX(50); setY(50); setError('');
      }} />
    </label>
    <p className="text-xs text-cui-muted">Images are public to email recipients. Do not upload customer documents.</p>
    {source ? <div className="space-y-2 rounded border border-cui-border p-3" aria-label="Crop image">
      <div className="overflow-hidden bg-cui-body" style={{ aspectRatio: String(ratio) }}>
        {/* The object URL is local to this crop preview; only the cropped pixels are uploaded. */}
        <img ref={image} alt="Crop preview" src={source} className="h-full w-full object-cover" onError={() => setError('This image could not be decoded.')}
          style={{ objectPosition: `${x}% ${y}%`, transform: `scale(${zoom})`, transformOrigin: `${x}% ${y}%` }} />
      </div>
      <label className="block text-xs">Shape<select className="crm-input" value={ratio} disabled={busy} onChange={(event) => setRatio(Number(event.target.value))}>
        <option value="3">Banner 3:1</option><option value="1.7777777777777777">Wide 16:9</option><option value="1">Square</option><option value="0.75">Portrait 3:4</option>
      </select></label>
      {([
        ['Zoom', zoom, 1, 4, 0.05, setZoom], ['Horizontal position', x, 0, 100, 1, setX], ['Vertical position', y, 0, 100, 1, setY],
      ] as const).map(([label, value, min, max, step, setter]) => <label key={label} className="block text-xs">{label}
        <input aria-label={label} className="block w-full" type="range" min={min} max={max} step={step} disabled={busy} value={value}
          onChange={(event) => setter(Number(event.target.value))} />
      </label>)}
      <div className="flex gap-2">
        <button type="button" className="crm-button" disabled={busy} onClick={() => setSource('')}>Cancel crop</button>
        <button type="button" className="crm-button crm-button-primary" disabled={busy} onClick={async () => {
          const element = image.current;
          if (!element?.naturalWidth) { setError('Wait for a valid image to load.'); return; }
          setBusy(true); onBusy?.(true); setError('');
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 1200; canvas.height = Math.round(canvas.width / ratio);
            const context = canvas.getContext('2d');
            if (!context) throw new Error('Your browser cannot crop this image.');
            const cover = Math.max(canvas.width / element.naturalWidth, canvas.height / element.naturalHeight) * zoom;
            const width = canvas.width / cover, height = canvas.height / cover;
            context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(element, (element.naturalWidth - width) * x / 100, (element.naturalHeight - height) * y / 100,
              width, height, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) =>
              value ? resolve(value) : reject(new Error('The image could not be cropped.')), 'image/jpeg', 0.9));
            const form = new FormData(); form.set('file', blob, 'email-image.jpg');
            const result = await workspaceFetch<{ image_url: string }>(endpoint, { method: 'POST', body: form });
            onUploaded(result.image_url); setSource('');
          } catch (failure) { setError(failure instanceof Error ? failure.message : 'Image upload failed.'); }
          finally { setBusy(false); onBusy?.(false); }
        }}>{busy ? 'Uploading...' : 'Use cropped image'}</button>
      </div>
    </div> : null}
    {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
  </div>;
}
