'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

function ChevronLeftIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M12.5 4.5 7 10l5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRightIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function QuoteIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path d="M4.5 6.5h11M4.5 10h11M4.5 13.5h7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ConvertIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="h-5 w-5">
      <path d="M4.5 6.5h7.25a3.25 3.25 0 0 1 3.25 3.25v0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 3.5 15 6.5 11.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15.5 13.5H8.25A3.25 3.25 0 0 1 5 10.25v0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 16.5 5 13.5 8.5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type CarrierResult = {
  eligible: boolean;
  reasons: string[];
};

type QuoteRow = {
  id: string;
  carrier: string;
  status: string;
  createdAt: string;
};

type QuoteResponse = {
  status: 'incomplete' | 'created';
  snapshot: Record<string, unknown>;
  completeness: { score: number; missing: string[] };
  carrierMatrix: Record<string, CarrierResult>;
  quote?: QuoteRow;
  quoteHistory?: QuoteRow[];
  convertedClientId?: string | null;
  message?: string;
};

type ConvertResponse = {
  status: 'converted' | 'already_converted';
  accountId: string;
  clientId: string;
  message?: string;
};

interface UnderwritingPanelProps {
  accountId: string | null;
  leadId?: string | null;
  initialCompletenessScore: number;
  initialCarrierMatrix: Record<string, CarrierResult>;
  underwritingFlags: string[];
}

export default function UnderwritingPanel({
  accountId,
  leadId,
  initialCompletenessScore,
  initialCarrierMatrix,
  underwritingFlags,
}: UnderwritingPanelProps): JSX.Element {
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Record<string, unknown> | null>(null);
  const [score, setScore] = useState<{ score: number; missing: string[] } | null>(null);
  const [carriers, setCarriers] = useState<Record<string, CarrierResult>>(initialCarrierMatrix);
  const [quote, setQuote] = useState<QuoteRow | null>(null);
  const [quoteHistory, setQuoteHistory] = useState<QuoteRow[]>([]);
  const [convertedClientId, setConvertedClientId] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  useEffect(() => {
    setCarriers(initialCarrierMatrix);
  }, [initialCarrierMatrix]);

  useEffect(() => {
    setScore((prev) => prev ?? { score: initialCompletenessScore, missing: [] });
  }, [initialCompletenessScore]);

  const actionButtonClassName =
    'inline-flex items-center justify-center rounded-md border border-[#d7d3cf] bg-white text-[#1f3f5b] shadow-sm transition hover:border-[#b8c7d8] hover:bg-[#eef4fb] focus:outline-none focus:ring-2 focus:ring-[#9cc3ea] focus:ring-offset-2';

  async function generateQuote(): Promise<void> {
    if (!accountId) {
      setError('Submit intake first to generate a quote.');
      return;
    }

    setError(null);
    setIsGenerating(true);

    const res = await fetch(`/commercial/intake/api/quote?id=${accountId}`, {
      method: 'POST',
    });

    const data = (await res.json().catch(() => ({ message: 'Quote generation failed.' }))) as QuoteResponse;

    if (!res.ok) {
      setError(data.message ?? 'Quote generation failed.');
      setIsGenerating(false);
      return;
    }

    setSnapshot(data.snapshot);
    setScore(data.completeness);
    setCarriers(data.carrierMatrix);
    setQuote(data.quote ?? null);
    setQuoteHistory(data.quoteHistory ?? []);
    setConvertedClientId(data.convertedClientId ?? null);

    if (leadId) {
      await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Quoted' }),
      }).catch(() => null);
    }

    setIsGenerating(false);
  }

  async function convertToClient(): Promise<void> {
    if (!accountId) {
      setError('Submit intake first to convert to client.');
      return;
    }

    setError(null);
    setIsConverting(true);

    const response = await fetch(`/commercial/intake/api/convert?id=${accountId}`, {
      method: 'POST',
    });

    const payload = (await response.json().catch(() => ({ message: 'Conversion failed.' }))) as ConvertResponse;
    if (!response.ok) {
      setError(payload.message ?? 'Conversion failed.');
      setIsConverting(false);
      return;
    }

    setConvertedClientId(payload.clientId);
    setIsConverting(false);
  }

  return (
    <aside
      className={`flex min-h-full flex-col border-l border-[#dddbda] bg-[#f8f8f7] shadow-sm transition-all duration-300 ease-in-out ${
        isActionsOpen ? 'w-full max-w-[380px] p-4' : 'w-[72px] items-center px-2 py-4'
      }`}
    >
      <div className={`flex w-full items-center ${isActionsOpen ? 'justify-between' : 'justify-center'}`}>
        {isActionsOpen ? <h3 className="text-base font-bold text-[#080707]">Underwriting Summary</h3> : <span className="sr-only">Underwriting Summary</span>}
        <button
          type="button"
          onClick={() => setIsActionsOpen((current) => !current)}
          className={`${actionButtonClassName} h-9 w-9`}
          title={isActionsOpen ? 'Collapse action drawer' : 'Expand action drawer'}
          aria-label={isActionsOpen ? 'Collapse action drawer' : 'Expand action drawer'}
        >
          {isActionsOpen ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
      </div>

      {isActionsOpen ? (
        <div className="mt-4 flex w-full flex-1 flex-col overflow-y-auto">
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => void generateQuote()}
              disabled={isGenerating}
              className="flex-1 rounded border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isGenerating ? 'Generating...' : 'Generate Quote'}
            </button>

            <button
              type="button"
              onClick={() => void convertToClient()}
              disabled={isConverting || !accountId}
              className="flex-1 rounded border border-[#0163b3] bg-[#0176d3] px-4 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {isConverting ? 'Converting...' : 'Convert To Client'}
            </button>
          </div>

          {convertedClientId ? (
            <div className="mb-4 rounded border border-[#dddbda] bg-white p-3">
              <h4 className="mb-2 text-sm font-semibold text-[#080707]">Client Conversion</h4>
              <p className="text-sm text-[#3e3e3c]">Converted client id: {convertedClientId}</p>
              <div className="mt-2 flex gap-2">
                <Link href={'/clients' as Route} className="rounded border border-[#0f62af] px-2 py-1 text-xs font-semibold text-[#0f62af] hover:bg-[#eef4fb]">
                  Open Clients
                </Link>
                <Link href={'/policies' as Route} className="rounded border border-[#0f62af] px-2 py-1 text-xs font-semibold text-[#0f62af] hover:bg-[#eef4fb]">
                  Add Policy
                </Link>
              </div>
            </div>
          ) : null}

          {error ? <p className="mb-3 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}

          {snapshot ? (
            <div className="mb-4 rounded border border-[#dddbda] bg-white p-3">
              <h4 className="mb-2 text-sm font-semibold text-[#080707]">Risk Snapshot</h4>
              <pre className="max-h-40 overflow-auto text-xs text-[#3e3e3c]">{JSON.stringify(snapshot, null, 2)}</pre>
            </div>
          ) : null}

          <div className="mb-4 rounded border border-[#dddbda] bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-[#080707]">Completeness Score</h4>
            <p className="text-sm text-[#1f3f5b]">Score: {score?.score ?? initialCompletenessScore}</p>
            <p className="text-xs text-rose-700">Missing: {score?.missing.length ? score.missing.join(', ') : 'None'}</p>
          </div>

          <div className="mb-4 rounded border border-[#dddbda] bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-[#080707]">Carrier Compatibility</h4>
            <ul className="space-y-2 text-sm">
              {Object.entries(carriers).length ? (
                Object.entries(carriers).map(([carrier, result]) => (
                  <li key={carrier} className="rounded border border-[#ecebea] px-2 py-1">
                    <p className="font-semibold text-[#080707]">{carrier}</p>
                    <p className={result.eligible ? 'text-emerald-700' : 'text-rose-700'}>{result.eligible ? 'Eligible' : 'Ineligible'}</p>
                    {!result.eligible && result.reasons.length > 0 ? <p className="text-xs text-[#6a6a6a]">{result.reasons.join(' ')}</p> : null}
                  </li>
                ))
              ) : (
                <li className="text-xs text-[#6a6a6a]">Complete intake fields to evaluate carriers.</li>
              )}
            </ul>
          </div>

          <div className="mb-4 rounded border border-[#dddbda] bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-[#080707]">Underwriting Flags</h4>
            {underwritingFlags.length ? (
              <ul className="space-y-1 text-sm text-[#3e3e3c]">
                {underwritingFlags.map((flag) => (
                  <li key={flag}>• {flag}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#6a6a6a]">No active flags.</p>
            )}
          </div>

          {quote ? (
            <div className="mb-4 rounded border border-[#dddbda] bg-white p-3">
              <h4 className="mb-2 text-sm font-semibold text-[#080707]">Quote Status</h4>
              <p className="text-sm text-[#3e3e3c]">Carrier: {quote.carrier}</p>
              <p className="text-sm text-[#3e3e3c]">Status: {quote.status}</p>
            </div>
          ) : null}

          <div className="rounded border border-[#dddbda] bg-white p-3">
            <h4 className="mb-2 text-sm font-semibold text-[#080707]">Quote History</h4>
            {quoteHistory.length ? (
              <ul className="space-y-2 text-xs text-[#3e3e3c]">
                {quoteHistory.map((row) => (
                  <li key={row.id} className="rounded border border-[#ecebea] px-2 py-1">
                    <p className="font-semibold text-[#080707]">{row.carrier}</p>
                    <p>Status: {row.status}</p>
                    <p>Created: {new Date(row.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#6a6a6a]">No quotes generated yet.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 flex w-full flex-1 flex-col items-center gap-3 pt-2">
          <button
            type="button"
            onClick={() => void generateQuote()}
            disabled={isGenerating}
            className={`${actionButtonClassName} h-10 w-10`}
            title={isGenerating ? 'Generating quote' : 'Generate quote'}
            aria-label={isGenerating ? 'Generating quote' : 'Generate quote'}
          >
            <QuoteIcon />
          </button>

          <button
            type="button"
            onClick={() => void convertToClient()}
            disabled={isConverting || !accountId}
            className={`${actionButtonClassName} h-10 w-10`}
            title={isConverting ? 'Converting client' : 'Convert to client'}
            aria-label={isConverting ? 'Converting client' : 'Convert to client'}
          >
            <ConvertIcon />
          </button>

          {error ? (
            <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700" title={error}>
              !
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}
