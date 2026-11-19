'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import SectionLayout from './SectionLayout';
import PolicyTermHistory from './PolicyTermHistory';
import { workspaceFetch } from '../../lib/workspace-fetch';

interface Term {
  id: string; client_id: string; insured_name: string; policy_number: string | null;
  carrier: string; status: string; source: string | null;
}

export default function PolicyWorkspaceRegister({ mode }: { mode: 'rewrites' | 'history' }): JSX.Element {
  const [page, setPage] = useState(0);
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void workspaceFetch<Term[]>(`/api/policies?page=${page}`).then((rows) => {
      if (!Array.isArray(rows)) throw new Error('Invalid policy register response.');
      if (active) setTerms(rows);
    }).catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Policy terms could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, refresh]);
  return <SectionLayout title={mode === 'rewrites' ? 'Policy Rewrites' : 'Policy Record History'}>
    <p className="mb-4 text-sm text-cui-muted">{mode === 'rewrites'
      ? 'Select the original policy term to record its replacement.'
      : 'Recorded revisions for each policy term.'}</p>
    <Link href="/policies" className="text-sm font-semibold text-cui-primary underline">Open policy register</Link>
    {loading ? <p role="status" className="mt-4 text-sm">Loading policy terms...</p> : error
      ? <p role="alert" className="mt-4 text-sm text-cui-danger">{error}<button onClick={() => setRefresh((value) => value + 1)} className="ml-2 underline">Retry policy terms</button></p>
      : <div className="mt-4 space-y-3">
        {!terms.length ? <p className="text-sm text-cui-muted">No policy terms on this page.</p> : null}
        {terms.map((term) => <section key={term.id} className="rounded border border-cui-border bg-white p-4">
          <h2 className="font-semibold">{term.insured_name} · {term.policy_number || 'No policy number'}</h2>
          <p className="mt-1 text-xs text-cui-muted">{term.carrier} · {term.status} · {term.source || 'Legacy source'}</p>
          <div className="mt-2 flex gap-4 text-sm font-semibold text-cui-primary">
            <Link href={`/clients/${term.client_id}?context_type=policy&context_id=${term.id}`} className="underline">Open term, documents and lineage</Link>
            {mode === 'rewrites' ? <Link href={`/policies?account_id=${term.client_id}&rewrite_from_id=${term.id}`} className="underline">Start rewrite</Link> : null}
          </div>
          {mode === 'history' ? <PolicyTermHistory accountId={term.client_id} policyId={term.id} /> : null}
        </section>)}
      </div>}
    <div className="mt-4 flex items-center gap-4 text-sm">
      <button disabled={loading || page === 0} onClick={() => setPage((value) => value - 1)} className="text-cui-primary disabled:opacity-50">Previous page</button>
      <span>Page {page + 1}</span>
      <button disabled={loading || Boolean(error) || terms.length < 100} onClick={() => setPage((value) => value + 1)} className="text-cui-primary disabled:opacity-50">Next page</button>
    </div>
  </SectionLayout>;
}
