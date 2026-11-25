'use client';
import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserAuthClient } from '../../../lib/supabase-auth-browser';
import { workspaceFetch } from '../../../lib/workspace-fetch';
import { inviteTokenHash } from '../../../lib/invite-token';

export default function AcceptInvitation(): JSX.Element {
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [ready, setReady] = useState(false);
  const [needsActivation, setNeedsActivation] = useState(false);
  const [challengeRequired, setChallengeRequired] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activation = useRef<Promise<{ needsActivation: boolean; challengeRequired?: boolean }> | null>(null);
  useEffect(() => {
    let active = true;
    activation.current ??= (async () => {
        const client = createSupabaseBrowserAuthClient();
        const params = new URLSearchParams(window.location.hash.slice(1));
        const challenge = params.get('challenge');
        const member = params.get('member');
        if (member || challenge) window.history.replaceState(null, '', '/auth/accept');
        if (challenge) {
          if (!/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error('Invalid setup link. Ask your administrator for a new invitation.');
          sessionStorage.setItem('crm:team-setup-challenge', challenge);
          if (!member) sessionStorage.removeItem('crm:team-setup-member');
        }
        if (member) {
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(member) || !challenge) {
            throw new Error('Invalid setup link. Ask your administrator for a new invitation.');
          }
          sessionStorage.setItem('crm:team-setup-member', member);
        }
        if (params.get('error')) throw new Error('Invitation expired or was rejected. Ask your administrator for a new invitation.');
        const access = params.get('access_token');
        const refresh = params.get('refresh_token');
        const query = new URLSearchParams(window.location.search);
        const code = query.get('code');
        const tokenHash = inviteTokenHash(params, query);
        const storedMember = sessionStorage.getItem('crm:team-setup-member');
        const storedChallenge = sessionStorage.getItem('crm:team-setup-challenge');
        const current = !member && storedMember ? await client.auth.getUser() : null;
        if (storedMember && storedChallenge && (member || (!access && !refresh && !code && !tokenHash && current?.data.user?.id !== storedMember))) {
          const proof = await workspaceFetch<{ token_hash: string }>('/api/auth/team-setup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ member: storedMember, challenge: storedChallenge }),
          });
          const result = await client.auth.verifyOtp({ type: 'magiclink', token_hash: proof.token_hash });
          if (result.error || result.data.user?.id !== storedMember) throw new Error('Invitation could not be accepted. Request a fresh invitation.');
        } else if (access && refresh) {
          const result = await client.auth.setSession({ access_token: access, refresh_token: refresh });
          window.history.replaceState(null, '', '/auth/accept');
          if (result.error) throw new Error('Invitation could not be accepted. Request a fresh invitation.');
        } else {
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
        const status = await workspaceFetch<{ needsActivation: boolean; challengeRequired?: boolean }>('/api/agency?activation=true');
        if (!status.needsActivation) {
          sessionStorage.removeItem('crm:team-setup-challenge');
          sessionStorage.removeItem('crm:team-setup-member');
          throw new Error('This account setup is already complete. Sign in to your account.');
        }
        if (status.needsActivation && status.challengeRequired) {
          const stored = sessionStorage.getItem('crm:team-setup-challenge');
          if (!stored) throw new Error('This setup link is unavailable. Ask your administrator for a new invitation.');
          await workspaceFetch('/api/agency?activation=true', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'verify', challenge: stored }),
          });
        }
        return status;
    })();
    void activation.current.then((status) => {
        if (active) { setNeedsActivation(status.needsActivation); setChallengeRequired(status.challengeRequired === true); setReady(true); }
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Invitation could not be verified.');
    });
    return () => { active = false; };
  }, []);
  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#091424] px-6 py-16 text-white">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_38%),linear-gradient(135deg,_rgba(17,24,39,0.94),_rgba(8,22,43,0.98))]" />
    <div className="absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,_rgba(14,165,233,0.2),_transparent)]" />
    <section className="relative w-full max-w-md space-y-4 rounded-[28px] border border-white/10 bg-white/8 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur">
    <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200/80">Shield Assurance</p>
    <h1 className="text-3xl font-semibold tracking-tight text-white">Join your team</h1>
    <p className="text-sm leading-6 text-slate-300">Choose a password to finish setting up your CRM account.</p>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    {ready ? <form className="space-y-3" onSubmit={(event) => {
      event.preventDefault(); setBusy(true); setError('');
      void createSupabaseBrowserAuthClient().auth.updateUser({ password }).then(async (result) => {
        if (result.error) throw new Error(result.error.message);
        if (needsActivation) await workspaceFetch('/api/agency?activation=true', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: challengeRequired
            ? JSON.stringify({ action: 'complete', challenge: sessionStorage.getItem('crm:team-setup-challenge'), phone, address }) : '{}',
        });
        sessionStorage.removeItem('crm:team-setup-challenge');
        sessionStorage.removeItem('crm:team-setup-member');
        window.location.assign('/');
      }).catch((failure: unknown) => setError(failure instanceof Error ? failure.message : 'Password could not be saved.')).finally(() => setBusy(false));
    }}>
      <label className="block text-sm font-semibold">New password<input required minLength={12} autoComplete="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/12 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-cyan-300/70" /></label>
      {challengeRequired && <>
        <label className="block text-sm font-semibold">Phone number<input required minLength={7} maxLength={32} type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/12 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-cyan-300/70" /></label>
        <label className="block text-sm font-semibold">Mailing address <span className="font-normal text-slate-300">(optional)</span><input maxLength={300} autoComplete="street-address" value={address} onChange={(event) => setAddress(event.target.value)} className="mt-1 w-full rounded-2xl border border-white/12 bg-slate-950/50 px-4 py-3 text-white outline-none focus:border-cyan-300/70" /></label>
      </>}
      <button disabled={busy} className="crm-button-primary disabled:opacity-60">Save password and continue</button>
    </form> : !error ? <p className="text-sm text-slate-300">Verifying invitation...</p> : null}
  </section></main>;
}
