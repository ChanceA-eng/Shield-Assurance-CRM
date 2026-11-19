'use client';

import { useEffect, useRef, useState } from 'react';
import { CAPTION_STARTERS } from '../../lib/social-captions';
import { workspaceFetch } from '../../lib/workspace-fetch';

export default function SocialCaptionHelp({ caption, onUse, disabled, onBusyChange }: {
  caption: string; onUse: (caption: string) => void; disabled: boolean; onBusyChange: (busy: boolean) => void;
}): JSX.Element {
  const [topic, setTopic] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selected, setSelected] = useState('');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const button = 'rounded-lg bg-white px-3 py-2 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition hover:ring-cui-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary disabled:opacity-50';
  useEffect(() => {
    let cancelled = false;
    void workspaceFetch<{ available: boolean }>('/api/social-marketing/captions').then((result) => {
      if (!cancelled) setAvailable(result.available);
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : 'Could not check AI availability.');
    });
    return () => { cancelled = true; };
  }, []);
  async function suggest(): Promise<void> {
    if (disabled || running.current) return;
    running.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const result = await workspaceFetch<{ captions: string[] }>('/api/social-marketing/captions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topic, caption }),
      });
      setSuggestions(result.captions);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not suggest captions. Your draft was not changed.');
    } finally { running.current = false; setBusy(false); onBusyChange(false); }
  }
  return <section aria-label="Caption help" className="space-y-4 rounded-2xl bg-slate-50 p-4">
    <div><h3 className="text-sm font-semibold">Caption starters</h3><p className="mt-1 text-xs text-slate-500">Free. Choose a starting point, then make it your own.</p></div>
    <div className="flex flex-wrap gap-2">{CAPTION_STARTERS.map((starter) => <button key={starter.id} type="button" className={button} disabled={disabled || busy} onClick={() => setSelected(starter.text)}>{starter.label}</button>)}</div>
    {selected ? <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{selected}</p>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-slate-500">{caption ? 'Replaces your current caption. Nothing is saved automatically.' : 'Adds to the editor. Nothing is saved automatically.'}</span>
        <button type="button" className={button} disabled={disabled || busy} onClick={() => { onUse(selected); setSelected(''); }}>{caption ? 'Replace caption' : 'Use caption'}</button>
      </div>
    </div> : null}
    <div className="border-t border-slate-200 pt-4">
      <h3 className="text-sm font-semibold">Optional AI suggestions</h3>
      <p className="mt-1 text-xs text-slate-500">Uses AI credits. Only the topic and current caption are sent. Do not include private customer information.</p>
      {available === false ? <p role="status" className="mt-2 text-xs text-slate-600">AI suggestions are unavailable. You can still use the free caption starters.</p> : null}
      <label className="mt-3 block text-xs font-semibold">Post topic<input value={topic} maxLength={500} disabled={disabled || busy}
        placeholder="For example: reviewing insurance after a move"
        onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
        onChange={(event) => setTopic(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-200 bg-white p-3 text-sm font-normal outline-none focus:border-cui-primary" /></label>
      {caption.length > 2000 ? <p className="mt-2 text-xs text-amber-800">Shorten the caption to 2,000 characters to request AI suggestions.</p> : null}
      <button type="button" className={`${button} mt-3`} disabled={disabled || busy || available !== true || !topic.trim() || caption.length > 2000} onClick={() => void suggest()}>{busy ? 'Suggesting captions...' : 'Generate 3 captions (uses AI credits)'}</button>
      {busy ? <p role="status" className="mt-2 text-xs text-slate-500">Requesting suggestions. Your draft is unchanged.</p> : null}
      {error ? <p role="alert" className="mt-3 text-sm text-red-800">{error}</p> : null}
      {suggestions.length ? <div className="mt-4 space-y-3">{suggestions.map((text, index) => <div key={text} className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
        <p className="whitespace-pre-wrap text-sm leading-relaxed">{text}</p>
        <button type="button" className={`${button} mt-2`} disabled={disabled || busy} onClick={() => setSelected(text)}>Preview option {index + 1}</button>
      </div>)}</div> : null}
    </div>
  </section>;
}
