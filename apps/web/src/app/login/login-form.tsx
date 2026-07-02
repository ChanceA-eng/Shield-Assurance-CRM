'use client';

import { useState, type FormEvent } from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserAuthClient } from '../../lib/supabase-auth-browser';

interface LoginFormProps {
  redirectTo: string;
}

export default function LoginForm({ redirectTo }: LoginFormProps): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (submitting) {
      return;
    }

    setSubmitting(true);
    setErrorMessage('');

    try {
      const supabase = createSupabaseBrowserAuthClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      router.replace(redirectTo as Route);
      router.refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to sign in right now.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#091424] px-6 py-16 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(56,189,248,0.18),_transparent_38%),linear-gradient(135deg,_rgba(17,24,39,0.94),_rgba(8,22,43,0.98))]" />
      <div className="absolute inset-x-0 top-0 h-56 bg-[linear-gradient(180deg,_rgba(14,165,233,0.2),_transparent)]" />

      <div className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-white/8 p-8 shadow-[0_30px_90px_rgba(0,0,0,0.45)] backdrop-blur">
        <div className="mb-8 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan-200/80">Shield Assurance</p>
          <h1 className="text-3xl font-semibold tracking-tight text-white">CRM Access Portal</h1>
          <p className="text-sm leading-6 text-slate-300">
            Sign in with your Supabase account to unlock the full CRM workspace and protected APIs.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <label htmlFor="email" className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              className="w-full rounded-2xl border border-white/12 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:bg-slate-950/70"
              placeholder="you@shieldassurance.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-300">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              className="w-full rounded-2xl border border-white/12 bg-slate-950/50 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-cyan-300/70 focus:bg-slate-950/70"
              placeholder="Enter your password"
            />
          </div>

          {errorMessage ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{errorMessage}</div>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:bg-cyan-300/70"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}