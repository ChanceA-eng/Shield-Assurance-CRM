'use client';
import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserAuthClient } from '../../../lib/supabase-auth-browser';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import { inviteTokenHash } from '../../../lib/invite-token';

export default function AcceptInvitation(): JSX.Element {
  const [password, setPassword] = useState('');
  const [ready, setReady] = useState(false);
  const [needsActivation, setNeedsActivation] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activation = useRef<Promise<{ needsActivation: boolean }> | null>(null);
  useEffect(() => {
    let active = true;
    activation.current ??= (async () => {
        const client = createSupabaseBrowserAuthClient();
        const params = new URLSearchParams(window.location.hash.slice(1));
        if (params.get('error')) throw new Error('Invitation expired or was rejected. Ask your administrator for a new invitation.');
        const access = params.get('access_token');
        const refresh = params.get('refresh_token');
        if (access && refresh) {
          const result = await client.auth.setSession({ access_token: access, refresh_token: refresh });
          window.history.replaceState(null, '', '/auth/accept');
          if (result.error) throw new Error('Invitation could not be accepted. Request a fresh invitation.');
        } else {
          const query = new URLSearchParams(window.location.search);
          const code = query.get('code');
          const tokenHash = inviteTokenHash(params, query);
          if (tokenHash) window.history.replaceState(null, '', '/auth/accept');
          const result = tokenHash ? await client.auth.verifyOtp({
            type: params.get('type') === 'invite' && params.get('proof') === 'recovery' ? 'recovery' : 'invite', token_hash: tokenHash,
          })
            : code ? await client.auth.exchangeCodeForSession(code) : null;
          if (result) {
            window.history.replaceState(null, '', '/auth/accept');
            if (result.error) throw new Error('Invitation could not be accepted. Request a fresh invitation.');
          }
        }
        return workspaceFetch<{ needsActivation: boolean }>('/api/agency?activation=true');
    })();
    void activation.current.then((status) => {
        if (active) { setNeedsActivation(status.needsActivation); setReady(true); }
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Invitation could not be verified.');
    });
    return () => { active = false; };
  }, []);
  return <main className="flex min-h-screen items-center justify-center bg-cui-body p-4"><section className="w-full max-w-md space-y-4 rounded border border-cui-border bg-white p-6">
    <h1 className="text-xl font-bold text-cui-text">Join your team</h1>
    <p className="text-sm text-cui-muted">Choose a password to finish setting up your CRM account.</p>
    {error ? <p role="alert" className="text-sm text-cui-danger">{error}</p> : null}
    {ready ? <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError('');
      void createSupabaseBrowserAuthClient().auth.updateUser({ password }).then(async (result) => {
        if (result.error) throw new Error(result.error.message);
        if (needsActivation) await workspaceFetch('/api/agency?activation=true', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
        });
        window.location.assign('/');
      }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Password could not be saved.')).finally(() => setBusy(false));
    }}>
      <label className="block text-sm font-semibold">New password<input required minLength={12} autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded border border-cui-border p-2" /></label>
      <button disabled={busy} className="rounded bg-cui-primary px-3 py-2 text-sm text-white disabled:opacity-60">Save password and continue</button>
    </form> : !error ? <p className="text-sm text-cui-muted">Verifying invitation...</p> : null}
  </section></main>;
}
