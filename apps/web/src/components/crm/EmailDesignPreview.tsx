'use client';

import { useState } from 'react';
import { renderEmailHtml, emailDesignErrors, type EmailDesign, type EmailFormatting } from '@crm/shared';

export default function EmailDesignPreview({ body, design, formatting }: { body: string; design?: EmailDesign; formatting?: EmailFormatting }): JSX.Element {
  const [mobile, setMobile] = useState(false);
  const errors = emailDesignErrors(design);
  let html = '';
  if (!errors.length) {
    try { html = renderEmailHtml(body, design, formatting); }
    catch (error) { errors.push(error instanceof Error ? error.message : 'Review the email formatting.'); }
  }
  return <section aria-label="Email design preview" className="min-w-0 space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Email preview</h3>
      <div role="group" aria-label="Preview width" className="flex gap-2 text-xs">
        <button type="button" aria-pressed={!mobile} onClick={() => setMobile(false)} className="rounded border border-cui-border px-2 py-1">Desktop</button>
        <button type="button" aria-pressed={mobile} onClick={() => setMobile(true)} className="rounded border border-cui-border px-2 py-1">Mobile</button>
      </div>
    </div>
    {errors.length ? <p className="text-xs text-cui-danger">{errors.join(' ')}</p>
      : <iframe title="Email design preview" sandbox="" referrerPolicy="no-referrer"
        srcDoc={html}
        className="mx-auto h-96 max-w-full rounded border border-cui-border bg-white"
        style={{ width: mobile ? 360 : '100%' }} />}
  </section>;
}
