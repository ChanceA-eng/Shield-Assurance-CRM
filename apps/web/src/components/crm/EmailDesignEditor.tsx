'use client';

import { DEFAULT_EMAIL_DESIGN, type EmailDesign } from '@crm/shared';
import EmailBlockWorkspace, { initialEmailRows, newEmailBlock } from './EmailBlockWorkspace';
import { documentFromText, type EmailBlock } from '@crm/shared';
import EmailImageUpload from './EmailImageUpload';

const control = 'crm-input mt-1';
const layouts = [
  { value: 'plain', label: 'Simple email' },
  { value: 'letter', label: 'Branded letter' },
  { value: 'welcome', label: 'Welcome' },
  { value: 'announcement', label: 'Announcement / invitation' },
] as const;

export default function EmailDesignEditor({ value, onChange, brandName = '', heading = '', onBannerUpload }: {
  value?: EmailDesign; onChange: (design: EmailDesign | undefined) => void;
  brandName?: string; heading?: string;
  onBannerUpload?: (busy: boolean) => void;
}): JSX.Element {
  const chooseLayout = (layout: string): void => {
    if (layout === 'plain') onChange(undefined);
    else if (layout === 'letter' || layout === 'welcome' || layout === 'announcement') {
      onChange({ ...(value ?? { ...DEFAULT_EMAIL_DESIGN, brand_name: brandName, heading }), layout });
    }
  };
  const change = (field: keyof EmailDesign, text: string): void => {
    if (value) onChange({ ...value, [field]: text });
  };
  const startWorkspace = (): void => {
    if (!value) return;
    const rows = initialEmailRows();
    const blocks: EmailBlock[] = [];
    if (value.logo_url) blocks.push({ ...newEmailBlock('image'), url: value.logo_url, alt: value.brand_name });
    if (value.heading || value.brand_name) blocks.push({ ...newEmailBlock('text'), document: documentFromText(value.heading || value.brand_name) });
    if (value.image_url && value.layout === 'announcement') blocks.push({ ...newEmailBlock('image'), url: value.image_url, alt: value.image_alt, href: value.image_link_url });
    blocks.push(...rows[0].columns[0]);
    if (value.button_url) blocks.push({ ...newEmailBlock('button'), text: value.button_label, href: value.button_url, background: value.accent_color });
    if (value.image_url && value.layout !== 'announcement') blocks.push({ ...newEmailBlock('image'), url: value.image_url, alt: value.image_alt, href: value.image_link_url });
    rows[0].columns = [blocks];
    onChange({ ...value, rows });
  };
  return <section aria-label="Email branding" className="space-y-3 rounded border border-cui-border p-3">
    <label className="block text-xs font-semibold">Email layout
      <select aria-label="Email layout" className={control} value={value?.layout ?? 'plain'} onChange={(event) => chooseLayout(event.target.value)}>
        {layouts.map((layout) => <option key={layout.value} value={layout.value}>{layout.label}</option>)}
      </select>
    </label>
    <div role="group" aria-label="Email layout styles" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {layouts.map((layout) => <button key={layout.value} type="button" aria-pressed={(value?.layout ?? 'plain') === layout.value}
        onClick={() => chooseLayout(layout.value)}
        className={`min-w-0 rounded border p-2 text-left text-xs ${value?.layout === layout.value || (!value && layout.value === 'plain')
          ? 'border-cui-primary bg-cui-primary/5' : 'border-cui-border hover:bg-cui-light'}`}>
        <span aria-hidden="true" className="mb-2 block h-24 overflow-hidden rounded border border-slate-200 bg-slate-100 p-2">
          <span className={`block h-full bg-white p-2 ${layout.value === 'plain' ? '' : 'border-t-4 border-cui-primary'}`}>
            <span className={`mb-2 block h-1.5 w-8 rounded bg-cui-primary ${layout.value === 'welcome' ? 'mx-auto' : ''}`} />
            {layout.value === 'announcement' ? <span className="mb-2 flex h-5 items-center justify-center bg-slate-200 text-[9px] text-slate-600">Image</span> : null}
            <span className="mb-1 block h-1 w-full rounded bg-slate-200" />
            <span className="mb-2 block h-1 w-3/4 rounded bg-slate-200" />
            {layout.value === 'welcome' ? <span className="mx-auto block h-3 w-9 rounded bg-cui-primary" /> : null}
            {layout.value === 'letter' ? <span className="block h-3 w-full bg-slate-200" /> : null}
          </span>
        </span>
        <span className="font-semibold">{layout.label}</span>
      </button>)}
    </div>
    {value ? <>
      {value.rows ? <>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Template design workspace</h2>
          <button type="button" className="crm-button" onClick={() => {
            if (window.confirm('Replace this custom layout with the fixed layout? Save to keep the change.')) {
              const { rows: _rows, ...fixed } = value; onChange(fixed);
            }
          }}>Use fixed layout</button>
        </div>
        <EmailBlockWorkspace rows={value.rows} onChange={(rows) => onChange({ ...value, rows })} onBusy={onBannerUpload} />
      </> : <>
      <button type="button" className="crm-button crm-button-primary" onClick={startWorkspace}>Build custom layout</button>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">Brand name<input className={control} maxLength={100} value={value.brand_name}
          onChange={(event) => change('brand_name', event.target.value)} /></label>
        <label className="block text-xs font-semibold">Heading<input className={control} maxLength={200} value={value.heading}
          onChange={(event) => change('heading', event.target.value)} /></label>
        <label className="block text-xs font-semibold">Brand color<input type="color" className={`${control} h-10`} value={value.accent_color}
          onChange={(event) => change('accent_color', event.target.value)} /></label>
        <label className="block text-xs font-semibold">Background color<input type="color" className={`${control} h-10`} value={value.background_color}
          onChange={(event) => change('background_color', event.target.value)} /></label>
      </div>
      {onBannerUpload ? <EmailImageUpload label="Upload logo image" onBusy={onBannerUpload}
        onUploaded={(url) => onChange({ ...value, logo_url: url })} /> : null}
      {value.logo_url ? <button type="button" className="crm-button" onClick={() => change('logo_url', '')}>Remove logo</button> : null}
      <div className="space-y-2 rounded border border-cui-border p-3">
        {onBannerUpload ? <EmailImageUpload label={value.image_url ? 'Replace banner image' : 'Upload banner image'} onBusy={onBannerUpload}
          onUploaded={(url) => onChange({ ...value, image_url: url })} />
          : <p className="text-xs text-cui-muted">Upload or replace the banner in Settings, under Templates and Branding.</p>}
        {value.image_url ? <>
          <button type="button" className="crm-button" onClick={() => onChange({ ...value, image_url: '', image_alt: '', image_link_url: '' })}>Remove banner</button>
          <label className="block text-xs font-semibold">Banner description<input className={control} maxLength={200} value={value.image_alt}
            onChange={(event) => change('image_alt', event.target.value)} /></label>
          <label className="block text-xs font-semibold">When clicked, go to (optional)<input type="url" className={control} maxLength={2000}
            placeholder="https://your-site.com/quote" value={value.image_link_url ?? ''} onChange={(event) => change('image_link_url', event.target.value)} /></label>
        </> : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-semibold">Button label<input className={control} maxLength={80} value={value.button_label}
          onChange={(event) => change('button_label', event.target.value)} /></label>
        <label className="block text-xs font-semibold">Button link<input type="url" className={control} maxLength={2000}
          placeholder="https://" value={value.button_url} onChange={(event) => change('button_url', event.target.value)} /></label>
      </div>
      </>}
    </> : null}
  </section>;
}
