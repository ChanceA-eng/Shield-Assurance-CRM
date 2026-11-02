'use client';

import { useEffect, useState } from 'react';
import { OUTREACH_TEMPLATES, isOutreachTemplate, type MarketingProfile, type RecordTarget } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';

const fields = [
  ['interests', 'Stated insurance interests'],
  ['priorities', 'Priorities / what matters most'],
  ['objections', 'Concerns to respect (internal context)'],
  ['next_step', 'Agreed next step'],
  ['source', 'Source (for example: customer call on Nov 2)'],
] as const;

export default function MarketingProfilePanel({ target }: { target: RecordTarget }): JSX.Element {
  const [profile, setProfile] = useState<MarketingProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const query = `record_type=${target.type}&record_id=${target.id}`;
  useEffect(() => {
    let active = true;
    setProfile(null); setError(null); setNotice('');
    void workspaceFetch<{ profile: MarketingProfile }>(`/api/outreach/profile?${query}`)
      .then((data) => { if (active) setProfile(data.profile); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Unable to load marketing profile.'); });
    return () => { active = false; };
  }, [query]);

  const save = async (): Promise<void> => {
    setBusy(true); setError(null); setNotice('');
    try {
      const saved = await workspaceFetch<{ profile: MarketingProfile }>(`/api/outreach/profile?${query}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }),
      });
      setProfile(saved.profile); setNotice('Marketing profile saved. Future drafts will use these preferences; existing drafts are unchanged.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Unable to save marketing profile.'); }
    finally { setBusy(false); }
  };

  return <details className="rounded border border-cui-border bg-white p-3">
    <summary className="cursor-pointer text-sm font-bold text-cui-text">Marketing profile &amp; email purpose</summary>
    <p className="mt-2 text-xs text-cui-muted">Record stated insurance needs, not inferred personal interests. Source and confirmation date are required for stated needs. Preferences do not grant permission to send. Linked leads use the account profile when available.</p>
    {error ? <p role="alert" className="mt-2 text-sm text-cui-danger">{error}</p> : null}
    {notice ? <p role="status" className="mt-2 text-sm text-green-700">{notice}</p> : null}
    {profile ? <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="mt-3 grid gap-3 sm:grid-cols-2">
      {fields.map(([key, label]) => <label key={key} className="text-xs font-semibold text-cui-muted">{label}
        <textarea maxLength={1000} rows={2} value={profile[key]} onChange={(event) => setProfile({ ...profile, [key]: event.target.value })}
          className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
      </label>)}
      <label className="text-xs font-semibold text-cui-muted">Last confirmed
        <input type="date" value={profile.confirmed_on} onChange={(event) => setProfile({ ...profile, confirmed_on: event.target.value })}
          className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text" />
      </label>
      <label className="text-xs font-semibold text-cui-muted">Preferred next-step channel
        <select value={profile.preferred_channel} onChange={(event) => {
          const value = event.target.value;
          if (value === 'unknown' || value === 'email' || value === 'phone' || value === 'sms') setProfile({ ...profile, preferred_channel: value });
        }} className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text">
          <option value="unknown">Not recorded</option><option value="email">Email</option><option value="phone">Phone</option><option value="sms">SMS</option>
        </select>
      </label>
      <label className="text-xs font-semibold text-cui-muted">Default email purpose
        <select value={profile.template} onChange={(event) => { if (isOutreachTemplate(event.target.value)) setProfile({ ...profile, template: event.target.value }); }}
          className="mt-1 w-full rounded border border-cui-border px-2 py-1.5 text-sm text-cui-text">
          {Object.entries(OUTREACH_TEMPLATES).map(([key, template]) => <option key={key} value={key}>{template.label}</option>)}
        </select>
      </label>
      <div className="sm:col-span-2"><button type="submit" disabled={busy} className="rounded bg-cui-primary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Saving...' : 'Save marketing profile'}</button></div>
    </form> : !error ? <p className="mt-2 text-sm text-cui-muted">Loading marketing profile...</p> : null}
  </details>;
}
