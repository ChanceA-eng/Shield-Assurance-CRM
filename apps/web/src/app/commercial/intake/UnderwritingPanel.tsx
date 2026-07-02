'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';

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
  initialCompletenessScore: number;
  initialCarrierMatrix: Record<string, CarrierResult>;
  underwritingFlags: string[];
}

export default function UnderwritingPanel({
  accountId,
  initialCompletenessScore,
  initialCarrierMatrix,
  underwritingFlags,
}: UnderwritingPanelProps): JSX.Element {
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
    <aside className="w-full max-w-[380px] rounded border border-[#dddbda] bg-[#f8f8f7] p-4 shadow-sm">
      <h3 className="mb-3 text-base font-bold text-[#080707]">Underwriting Summary</h3>

      <button
        type="button"
        onClick={() => void generateQuote()}
        disabled={isGenerating}
        className="mb-4 rounded border border-emerald-700 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isGenerating ? 'Generating...' : 'Generate Quote'}
      </button>

      <button
        type="button"
        onClick={() => void convertToClient()}
        disabled={isConverting || !accountId}
        className="mb-4 ml-2 rounded border border-[#0163b3] bg-[#0176d3] px-4 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:cursor-not-allowed disabled:opacity-70"
      >
        {isConverting ? 'Converting...' : 'Convert To Client'}
      </button>

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
    </aside>
  );
}
