'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OutreachSender } from '@crm/shared';
import type { OutreachSettings } from '../../lib/outreach-engine';
import type { SenderOptions } from '../../lib/sender-options';
import { SENDER_JOB_TITLES } from '../../lib/sender-options';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { DEFAULT_AGENCY_TIME_ZONE, SUPPORTED_AGENCY_TIME_ZONES } from '../../lib/agency-time';
import { useUnsavedChanges } from '../../context/WorkspaceNavigationContext';

const control = 'crm-input mt-1 block h-11 sm:h-9';
const multiline = 'crm-input mt-1';
const fields = [
  ['name', 'Producer name'], ['role', 'Job title'], ['agency', 'Agency'],
  ['service_area', 'Service area'], ['specialties', 'Specialties'], ['tone', 'Writing style'],
] as const;

export default function AgencyOutreachSettings({ section = 'all' }: { section?: 'all' | 'sender' | 'sending' }): JSX.Element {
  const [settings, setSettings] = useState<OutreachSettings | null>(null);
  const [options, setOptions] = useState<SenderOptions>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [customJobTitle, setCustomJobTitle] = useState(false);
  const [revision, setRevision] = useState<number | null>(null);
  const [baseline, setBaseline] = useState('');
  useUnsavedChanges(Boolean(settings) && JSON.stringify(settings) !== baseline);
  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    const data = await workspaceFetch<{ settings: OutreachSettings; sender_options: SenderOptions; revision: number }>('/api/settings/outreach');
    if (version !== loadVersion.current) return;
    setSettings(data.settings); setOptions(data.sender_options);
    setBaseline(JSON.stringify(data.settings));
    setRevision(data.revision);
    setCustomJobTitle(/[\r\n]/.test(data.settings.sender_profile.role));
  }, []);
  useEffect(() => {
    void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Settings could not be loaded.'));
    return () => { loadVersion.current++; };
  }, [load]);
  const updateSender = (key: keyof OutreachSender, value: string): void => {
    setSettings((current) => current ? { ...current, sender_profile: { ...current.sender_profile, [key]: value } } : current);
    setNotice('');
  };
  return <div className="mx-auto max-w-5xl">
    {error ? <div className="mb-3 flex items-center justify-between gap-3">
      <p role="alert" className="text-sm text-cui-danger">{error}</p>
      {settings ? <button type="button" disabled={busy} className="shrink-0 text-sm font-semibold text-cui-primary underline"
        onClick={() => {
          if (!window.confirm('Reload saved settings and discard your unsaved changes?')) return;
          setBusy(true); setNotice('');
          void load().then(() => setError(''))
            .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Settings could not be loaded.'))
            .finally(() => setBusy(false));
        }}>Reload saved settings</button> : null}
    </div> : null}
    {notice ? <p role="status" className="mb-3 text-sm text-green-800">{notice}</p> : null}
    {!settings ? <button type="button" onClick={() => {
      setError(''); void load().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Settings could not be loaded.'));
    }} className="text-sm text-cui-primary underline">Load outreach settings</button> : <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault();
      if (!settings.approval_mode && !window.confirm('Allow the automatic engine to send eligible sequence drafts without manual approval? This can affect existing active sequences. Consent, reply readiness and delivery protections still apply.')) return;
      setBusy(true); setError(''); setNotice('');
      void workspaceFetch('/api/settings/outreach', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_mode: settings.approval_mode, daily_send_cap: settings.daily_send_cap,
          send_window_start: settings.send_window_start, send_window_end: settings.send_window_end,
          timezone: settings.timezone ?? DEFAULT_AGENCY_TIME_ZONE,
          sender_profile: settings.sender_profile, confirm_automatic_sending: !settings.approval_mode, expected_revision: revision,
        }),
      }).then(async () => { await load(); setNotice('Settings saved.'); })
        .catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Settings could not be saved.'))
        .finally(() => setBusy(false));
    }}>
      {section !== 'sending' ? <Card><CardHeader>Agency sender profile</CardHeader><CardBody className="py-3">
        <fieldset disabled={busy} aria-label="Agency sender profile" className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="min-w-0 space-y-3">
            <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
              {fields.map(([key, label]) => {
                const id = `agency-sender-${key}`;
                const value = settings.sender_profile[key];
                const suggestions = options[key] ?? [];
                const multipleLines = /[\r\n]/.test(value);
                return <div key={key} className="min-w-0">
                  <label htmlFor={id} className="block text-xs font-semibold text-cui-muted">{label}</label>
                  {key === 'role' ? <>
                    <select id={id} value={customJobTitle ? 'custom' : `title:${value}`} className={control}
                      onChange={(event) => {
                        const custom = event.target.value === 'custom';
                        setCustomJobTitle(custom);
                        if (!custom) updateSender('role', event.target.value.slice(6));
                      }}>
                      <option value="title:">Select job title</option>
                      {[...new Set([...SENDER_JOB_TITLES, ...suggestions, value])].filter((title) => title.trim() && !/[\r\n]/.test(title))
                        .map((title) => <option key={title} value={`title:${title}`}>{title}</option>)}
                      <option value="custom">Other / custom title</option>
                    </select>
                    {customJobTitle ? <div className="mt-2">
                      <label htmlFor={`${id}-custom`} className="block text-xs font-semibold text-cui-muted">Custom job title</label>
                      {multipleLines ? <textarea id={`${id}-custom`} rows={2} maxLength={1000} value={value}
                        onChange={(event) => updateSender('role', event.target.value)} className={multiline} /> : <input id={`${id}-custom`} maxLength={1000} value={value}
                        onChange={(event) => updateSender('role', event.target.value)} className={control} />}
                    </div> : null}
                  </> : multipleLines ? <textarea id={id} required={key === 'name' || key === 'agency'} rows={2} maxLength={1000} value={value}
                    onChange={(event) => updateSender(key, event.target.value)} className={multiline} /> : <input
                    id={id} list={`${id}-options`} required={key === 'name' || key === 'agency'} maxLength={1000} value={value}
                    onChange={(event) => updateSender(key, event.target.value)} className={control} />}
                  <datalist id={`${id}-options`}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist>
                </div>;
              })}
            </div>
            <div>
              <label htmlFor="agency-sender-signature" className="block text-xs font-semibold text-cui-muted">Signature</label>
              <textarea id="agency-sender-signature" required rows={3} maxLength={1000} value={settings.sender_profile.signature}
                onChange={(event) => updateSender('signature', event.target.value)} className={multiline} />
            </div>
            <details className="rounded border border-cui-border">
              <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-cui-text">
                Approved agency claims {settings.sender_profile.approved_claims.trim() ? '(configured)' : '(none)'}
              </summary>
              <div className="border-t border-cui-border px-3 pb-3 pt-2">
                <label htmlFor="agency-sender-claims" className="text-xs font-semibold text-cui-muted">Approved agency claims (no unverified promises)</label>
                <textarea id="agency-sender-claims" rows={3} maxLength={1000} value={settings.sender_profile.approved_claims}
                  onChange={(event) => updateSender('approved_claims', event.target.value)} className={multiline} />
              </div>
            </details>
          </div>
          <aside aria-label="Signature preview" className="min-w-0 self-start rounded border border-cui-primary/20 bg-cui-primary/5 p-3">
            <h3 className="text-xs font-semibold text-cui-muted">Signature preview</h3>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-cui-text">{settings.sender_profile.signature}</p>
          </aside>
        </fieldset>
      </CardBody></Card> : null}
      {section !== 'sender' ? <Card><CardBody className="py-3">
        <fieldset disabled={busy} aria-label="Sending controls" className="space-y-2">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,1fr))]">
            <label className="flex min-h-11 items-center gap-2 self-end text-sm font-semibold sm:col-span-3 sm:min-h-9 lg:col-span-1">
              <input type="checkbox" checked={settings.approval_mode} onChange={(event) => setSettings({ ...settings, approval_mode: event.target.checked })} />
              Require approval before sending
            </label>
            {([
              ['daily_send_cap', 'Daily send cap', 1, 200],
              ['send_window_start', 'Send window start (hour)', 0, 23],
              ['send_window_end', 'Send window end (hour)', 1, 24],
            ] as const).map(([key, label, min, max]) => <div key={key}>
              <label htmlFor={`agency-${key}`} className="block text-xs font-semibold text-cui-muted">{label}</label>
              <input id={`agency-${key}`} required type="number" step={1} min={min} max={max} value={Number.isNaN(settings[key]) ? '' : settings[key]}
                onChange={(event) => setSettings({ ...settings, [key]: event.target.valueAsNumber })} className={control} />
            </div>)}
            <div>
              <label htmlFor="agency-timezone" className="block text-xs font-semibold text-cui-muted">Agency time zone</label>
              <select id="agency-timezone" value={settings.timezone ?? DEFAULT_AGENCY_TIME_ZONE}
                onChange={(event) => setSettings({ ...settings, timezone: event.target.value })} className={control}>
                {SUPPORTED_AGENCY_TIME_ZONES.map((timezone) => <option key={timezone} value={timezone}>{timezone.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <button disabled={busy} className="h-11 shrink-0 rounded bg-cui-primary px-4 text-sm font-semibold text-white disabled:opacity-60 sm:h-9">{busy ? 'Saving...' : 'Save settings'}</button>
          </div>
        </fieldset>
      </CardBody></Card> : <div className="flex justify-end"><button disabled={busy} className="h-9 rounded bg-cui-primary px-4 text-sm font-semibold text-white disabled:opacity-60 max-sm:h-11">{busy ? 'Saving...' : 'Save settings'}</button></div>}
    </form>}
  </div>;
}
