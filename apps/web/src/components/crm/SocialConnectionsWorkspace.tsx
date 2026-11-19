'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { SocialConnectionCommand, SocialConnectionsList, SocialProviderConnection } from '@crm/shared';
import { workspaceFetch } from '../../lib/workspace-fetch';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { CheckCircle2, ExternalLink, Link2Off, RefreshCw, ShieldAlert } from 'lucide-react';

const endpoint = '/api/social-marketing/connections';
const button = 'inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cui-primary disabled:cursor-not-allowed disabled:opacity-50';
const stateLabels: Record<SocialProviderConnection['state'], string> = {
  connected: 'Connected', reconnect: 'Reconnect required', revocation_pending: 'Revocation pending', disconnected: 'Disconnected',
};
export default function SocialConnectionsWorkspace({ disabled = false, onBusyChange }: {
  disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}): JSX.Element {
  const [data, setData] = useState<SocialConnectionsList | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [instagramChoices, setInstagramChoices] = useState<Record<string, boolean>>({});
  const [confirmation, setConfirmation] = useState<{ action: 'disconnect_account' | 'revoke_grant'; id: string; label: string } | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const current = ++generation.current;
    try {
      const result = await workspaceFetch<SocialConnectionsList>(endpoint);
      if (current !== generation.current) return;
      setData(result); setError('');
      if (result.discovery_error) setError(result.discovery_error);
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : 'Could not load connected accounts.');
    }
  }, []);
  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const connection = params.get('connection');
    if (connection === 'ready') setNotice('Meta authorization succeeded. Choose the Facebook Page you want this CRM workspace to manage.');
    else if (connection === 'denied') setError('Meta authorization was canceled. No account was connected.');
    if (connection) {
      params.delete('connection');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    return () => { generation.current++; };
  }, [load]);

  async function run(value: SocialConnectionCommand): Promise<void> {
    if (lock.current || disabled) return;
    lock.current = true; generation.current++;
    setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
    try {
      await workspaceFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
      setConfirmation(null);
      setNotice(value.action === 'disconnect_account' ? 'Account disconnected in the CRM.' :
        value.action === 'revoke_grant' ? 'Meta authorization revoked. Connected accounts from that login are disabled.' :
          value.action === 'finish_selection' ? 'Account selection complete.' : 'Account connection saved.');
      await load();
    } catch (failure) {
      await load();
      setError(failure instanceof Error ? failure.message : 'Could not update social account access.');
    } finally { lock.current = false; setBusy(false); onBusyChange?.(false); }
  }
  async function startOAuth(): Promise<void> {
    if (lock.current || disabled || !data?.enabled || !data.can_manage) return;
    lock.current = true; generation.current++; setBusy(true); onBusyChange?.(true); setError('');
    try {
      const response = await workspaceFetch<{ url: string }>(`${endpoint}/oauth`, { method: 'POST' });
      const target = new URL(response.url);
      if (target.origin !== 'https://www.facebook.com' || !target.pathname.endsWith('/dialog/oauth')) throw new Error('Meta returned an invalid authorization destination.');
      window.location.assign(target.toString());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not start Meta authorization.');
      lock.current = false; setBusy(false); onBusyChange?.(false);
    }
  }
  const accounts = data?.connections ?? [];
  const connected = (platform: SocialProviderConnection['platform'], id: string): boolean =>
    accounts.some((account) => account.platform === platform && account.external_account_id === id && account.state === 'connected');
  const revocableGrants = (data?.grants ?? []).filter((grant) => grant.state !== 'disconnected');
  const locked = busy || disabled;

  return <div className="space-y-5">
    <Card className="!rounded-2xl !border-slate-200">
      <CardHeader className="flex-wrap !bg-white" actions={<div className="flex gap-2">
        <button type="button" className={button} disabled={locked} onClick={() => void load()}><RefreshCw size={14} aria-hidden />Refresh</button>
        {data?.enabled && data.can_manage ? <button type="button" className={button} disabled={locked} onClick={() => void startOAuth()}><ExternalLink size={14} aria-hidden />Connect Meta account</button> : null}
      </div>}>Connected accounts</CardHeader>
      <CardBody>
        <p className="mb-4 text-sm text-slate-600">Connect a Facebook Page and its linked professional Instagram account. Connecting does not publish posts.</p>
        {error ? <p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p> : null}
        {notice ? <p role="status" className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</p> : null}
        {data?.setup_issues.length ? <div className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">Connecting Meta accounts is currently unavailable. Resolve these setup items before enabling it:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">{data.setup_issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
        </div> : null}
        {!data && !error ? <p role="status" className="py-5 text-sm text-slate-500">Loading connected accounts…</p> : null}
        {data && accounts.length ? <div className="space-y-3">
          {accounts.map((account) => <article key={account.id} className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-slate-900">{account.account_name}</p>
                <p className="mt-1 text-xs text-slate-500">{account.platform === 'facebook_page' ? 'Facebook Page' : `Instagram professional account${account.username ? ` · @${account.username}` : ''}`}</p>
                <p className="mt-2 flex items-center gap-1.5 text-xs">
                  {account.state === 'connected' && account.can_publish
                    ? <CheckCircle2 size={14} className="text-emerald-700" aria-hidden />
                    : <ShieldAlert size={14} className="text-amber-700" aria-hidden />}
                  <span className={account.state === 'connected' && account.can_publish ? 'text-emerald-800' : 'text-amber-800'}>
                    {account.state === 'connected' && account.can_publish ? 'Permissions ready for publishing' : stateLabels[account.state]}
                  </span>
                </p>
                {account.state === 'connected' && account.capability_reason ? <p className="mt-1 text-xs text-amber-800">{account.capability_reason}</p> : null}
                {account.state === 'revocation_pending' ? <p className="mt-1 text-xs text-amber-800">CRM publishing is disabled while Meta revocation is retried or completed in Meta settings.</p> : null}
                {account.token_expires_at ? <p className="mt-1 text-xs text-slate-500">Authorization expires {new Date(account.token_expires_at).toLocaleDateString()}</p> : null}
              </div>
              {data.can_manage && account.state !== 'disconnected' ? <button type="button" className={button} disabled={locked}
                onClick={() => setConfirmation({ action: 'disconnect_account', id: account.id, label: account.account_name })}>
                <Link2Off size={14} aria-hidden />Disconnect account
              </button> : null}
            </div>
          </article>)}
        </div> : data && !accounts.length ? <div className="rounded-xl border border-dashed border-slate-300 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-slate-800">No social accounts connected</p>
          <p className="mt-1 text-xs text-slate-500">{data.enabled ? 'Connect Meta, then choose a Page to manage.' : 'Connecting Meta accounts is currently unavailable.'}</p>
        </div> : null}
        {data?.can_manage && revocableGrants.length ? <div className="mt-4 space-y-3">
          {revocableGrants.map((grant) => <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-100 bg-white p-3">
            <p className="text-xs text-slate-600">Revoke Meta authorization for <span className="font-semibold">{grant.user_name}</span>. All Pages and linked Instagram accounts under it will be disconnected.</p>
            <button type="button" className={button} disabled={locked} onClick={() => setConfirmation({ action: 'revoke_grant', id: grant.id, label: `the ${grant.user_name} Meta login and all accounts connected through it` })}>
              <ShieldAlert size={14} aria-hidden />{grant.state === 'revocation_pending' ? 'Retry Meta revocation' : 'Revoke Meta authorization'}
            </button>
          </div>)}
        </div> : null}
      </CardBody>
    </Card>

    {data?.oauth_expires_at ? <Card className="!rounded-2xl !border-slate-200">
      <CardHeader className="!bg-white" actions={<span className="text-xs text-slate-500">Selection expires {new Date(data.oauth_expires_at).toLocaleTimeString()}</span>}>Choose authorized Pages</CardHeader>
      <CardBody>
        <p className="mb-4 text-xs text-slate-500">Only Pages and linked professional Instagram accounts returned by Meta are selectable. Selecting again safely updates that saved account.</p>
        <div className="space-y-3">{data.candidates.map((candidate) => {
          const facebookConnected = connected('facebook_page', candidate.id);
          const instagramId = candidate.instagram_business_account?.id;
          const instagramConnected = instagramId ? connected('instagram_business', instagramId) : false;
          const includeInstagram = instagramChoices[candidate.id] ?? instagramConnected;
          const done = facebookConnected && (includeInstagram ? instagramConnected : !instagramConnected);
          return <article key={candidate.id} className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/70 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-900">{candidate.name}</p>
              <p className="mt-1 text-xs text-slate-500">Facebook Page {candidate.category ? `· ${candidate.category}` : ''}</p>
              {!candidate.can_publish_facebook ? <p className="mt-2 text-xs text-amber-800">{candidate.facebook_block_reason}</p> : null}
              {candidate.instagram_business_account ? <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
                <input type="checkbox" className="mt-0.5 accent-cui-primary" disabled={locked || !candidate.can_publish_instagram}
                  checked={includeInstagram} onChange={(event) => setInstagramChoices((previous) => ({ ...previous, [candidate.id]: event.target.checked }))} />
                <span>Also connect {candidate.instagram_business_account.username ? `@${candidate.instagram_business_account.username}` : 'the linked Instagram account'}
                  {!candidate.can_publish_instagram ? <span className="mt-1 block text-amber-800">{candidate.instagram_block_reason}</span> : null}
                  {instagramConnected ? <span className="mt-1 block text-emerald-800">Already connected</span> : null}
                </span>
              </label> : null}
            </div>
            <button type="button" className={button} disabled={locked || !candidate.can_publish_facebook || done}
              onClick={() => void run({ action: 'select_page', page_id: candidate.id, include_instagram: includeInstagram })}>
              {done ? 'Connected' : facebookConnected ? 'Update selection' : 'Connect Page'}
            </button>
          </article>;
        })}</div>
        {!data.candidates.length ? <p className="py-5 text-center text-sm text-slate-500">Meta did not return any Pages for this login.</p> : null}
        {data.can_manage ? <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" className={button} disabled={locked} onClick={() => void run({ action: 'finish_selection' })}>Finish account selection</button>
        </div> : null}
      </CardBody>
    </Card> : null}

    <Dialog.Root open={confirmation !== null} onOpenChange={(open) => { if (!open && !busy) setConfirmation(null); }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[100] bg-slate-950/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[100] w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl">
          <Dialog.Title className="text-base font-semibold text-slate-900">
            {confirmation?.action === 'revoke_grant' ? 'Revoke Meta access?' : 'Disconnect this account?'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">
            {confirmation?.action === 'revoke_grant'
              ? `Meta will revoke this CRM app's authorization for ${confirmation.label}. All accounts connected through that login are disabled.`
              : `${confirmation?.label} will stop being available to the CRM. This does not revoke the full Meta login; use the separate revoke control for that.`}
          </Dialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close asChild><button type="button" className={button} disabled={busy}>Keep connected</button></Dialog.Close>
            <button type="button" className="rounded-xl bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50" disabled={busy}
              onClick={() => { if (confirmation) void run(confirmation.action === 'revoke_grant'
                ? { action: 'revoke_grant', grant_id: confirmation.id } : { action: 'disconnect_account', id: confirmation.id }); }}>
              {confirmation?.action === 'revoke_grant' ? 'Revoke access' : 'Disconnect account'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}
