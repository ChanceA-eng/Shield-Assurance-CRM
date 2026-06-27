'use client';

import Link from 'next/link';
import type { Route } from 'next';
import React, { useEffect, useState } from 'react';

interface DocumentInsight {
  id: string;
  insightIndex: number;
  content: string;
  createdAt: string;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  carrierName: string | null;
  stateContext: string | null;
  policyType: string | null;
  topic: string | null;
  topicTags: string[];
  summary: string | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  insights: DocumentInsight[];
}

interface QueryCitation {
  documentId: string;
  documentTitle: string;
  sourceUrl: string | null;
  sourceType: string;
  insightIndex: number;
  score: number;
  carrierName: string | null;
  stateContext: string | null;
  policyType: string | null;
}

interface QueryResponse {
  question: string;
  answer: string;
  citations: QueryCitation[];
}

interface AnalyzeResponse {
  documentId: string;
  documentTitle: string;
  action: 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';
  summary: string;
  citations: Array<{
    documentId: string;
    documentTitle: string;
    sourceType: string;
    sourceUrl: string | null;
  }>;
}

const quickActions = [
  {
    id: 'APPETITE',
    label: 'Extract Appetite',
    prompt: 'Extract underwriting appetite guidance and target-risk conditions from this document.',
  },
  {
    id: 'ELIGIBILITY',
    label: 'Extract Eligibility',
    prompt: 'Extract eligibility criteria and underwriting requirements from this document.',
  },
  {
    id: 'EXCLUSIONS',
    label: 'Extract Exclusions',
    prompt: 'Summarize explicit exclusions, ineligible classes, and declination triggers from this document.',
  },
  {
    id: 'DECISION',
    label: 'Build Decision Summary',
    prompt: 'Provide a concise underwriting decision posture with conditions, if any, based only on this document.',
  },
] as const;

export default function RashiDocumentView({ documentId }: { documentId: string }): JSX.Element {
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [reingesting, setReingesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<QueryResponse | null>(null);

  useEffect(() => {
    const loadDocument = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/rashi/documents/${documentId}`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Failed to load document.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to load document.');
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as KnowledgeDocument;
      setDocument(payload);
      setLoading(false);
    };

    void loadDocument();
  }, [documentId]);

  const runQuickAction = async (action: 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION', actionPrompt: string): Promise<void> => {
    setQuerying(true);
    setError(null);

    const response = await fetch('/api/rashi/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, question: actionPrompt, documentId }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to query document.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to query document.');
      setQuerying(false);
      return;
    }

    const payload = (await response.json()) as AnalyzeResponse;

    const queryProxy: QueryResponse = {
      question: actionPrompt,
      answer: payload.summary,
      citations: payload.citations.map((citation) => ({
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        sourceUrl: citation.sourceUrl,
        sourceType: citation.sourceType,
        insightIndex: 0,
        score: 1,
        carrierName: null,
        stateContext: null,
        policyType: null,
      })),
    };

    setAnswer(queryProxy);
    setQuerying(false);
  };

  const handleReingest = async (): Promise<void> => {
    setReingesting(true);
    setError(null);

    const response = await fetch(`/api/rashi/documents/${documentId}/reingest`, {
      method: 'POST',
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to re-ingest document.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to re-ingest document.');
      setReingesting(false);
      return;
    }

    const refreshed = await fetch(`/api/rashi/documents/${documentId}`, { cache: 'no-store' });
    if (refreshed.ok) {
      const payload = (await refreshed.json()) as KnowledgeDocument;
      setDocument(payload);
    }

    setReingesting(false);
  };

  const getEmbeddedSourceUrl = (sourceUrl: string): string => {
    if (!sourceUrl) {
      return sourceUrl;
    }

    const normalized = sourceUrl.trim();
    const youtubeWatch = normalized.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
    if (youtubeWatch?.[1]) {
      return `https://www.youtube.com/embed/${youtubeWatch[1]}`;
    }

    return normalized;
  };

  if (loading) {
    return <div className="text-sm text-[#64748b]">Loading document...</div>;
  }

  if (error) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>;
  }

  if (!document) {
    return <div className="text-sm text-[#64748b]">Document not found.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={'/rashi' as Route} className="inline-flex items-center gap-2 rounded-full bg-[#eef3f8] px-3 py-1.5 text-xs font-semibold text-[#0b2545] hover:bg-[#dbe8f4]">
          Back to Rashi Workspace
        </Link>
      </div>

      <section className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0f62af]">{document.sourceType}</p>
            <h2 className="mt-2 text-2xl font-bold text-[#081a30]">{document.title}</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-[#475569]">{document.summary ?? 'This document is still processing or does not have a generated summary yet.'}</p>
          </div>
          <div className="rounded-2xl border border-[#e2e8f0] bg-[#f8fbff] p-4 text-sm text-[#334155]">
            <p>Status: <span className="font-semibold text-[#081a30]">{document.status}</span></p>
            <p className="mt-2">Key Points: <span className="font-semibold text-[#081a30]">{document.insights.length}</span></p>
            <button
              type="button"
              onClick={() => void handleReingest()}
              disabled={reingesting}
              className="mt-3 inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
            >
              {reingesting ? 'Re-ingesting...' : 'Re-generate Key Points'}
            </button>
            {document.sourceUrl ? (
              <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block font-semibold text-[#0f62af] hover:underline">
                Open source link
              </a>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          {document.carrierName ? <Link href={`/rashi/carrier/${document.carrierName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` as Route} className="rounded-full bg-[#e8f1fb] px-2.5 py-1 font-semibold text-[#0f62af]">{document.carrierName}</Link> : null}
          {document.stateContext ? <Link href={`/rashi/state/${document.stateContext.toLowerCase()}` as Route} className="rounded-full bg-[#eef2ff] px-2.5 py-1 font-semibold text-[#3730a3]">{document.stateContext}</Link> : null}
          {document.policyType ? <Link href={`/rashi/policy/${document.policyType.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` as Route} className="rounded-full bg-[#ecfccb] px-2.5 py-1 font-semibold text-[#3f6212]">{document.policyType}</Link> : null}
          {document.topic ? <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 font-semibold text-[#475569]">{document.topic}</span> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold text-[#081a30]">AI Tools</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => void runQuickAction(action.id, action.prompt)}
              disabled={querying}
              className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {action.label}
            </button>
          ))}
        </div>

        {answer ? (
          <div className="mt-4 rounded-2xl border border-[#d8e6f6] bg-[#f6fbff] p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-[#223041]">{answer.answer}</pre>
            <div className="mt-4 space-y-3">
              {answer.citations.map((citation) => (
                <div key={`${citation.documentId}-${citation.insightIndex}`} className="rounded-xl border border-[#d8e6f6] bg-white p-3">
                  <p className="text-sm font-semibold text-[#081a30]">{citation.documentTitle}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[#64748b]">
                    {citation.sourceType}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold">
                    {citation.sourceUrl ? (
                      <a href={citation.sourceUrl} target="_blank" rel="noreferrer" className="text-[#0f62af] hover:underline">
                        Open Source
                      </a>
                    ) : null}
                    <Link href={`/rashi/document/${citation.documentId}` as Route} className="text-[#0176d3] hover:underline">
                      Open Key Point
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold text-[#081a30]">Source Asset Viewer</p>
        <div className="mt-4 h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          {document.sourceUrl ? (
            document.sourceType === 'PDF' ? (
              <iframe
                src={`${getEmbeddedSourceUrl(document.sourceUrl)}#view=FitH`}
                className="h-full w-full border-none"
                title={document.title}
              />
            ) : document.sourceType === 'ARTICLE' || document.sourceType === 'LINK' ? (
              <iframe
                src={getEmbeddedSourceUrl(document.sourceUrl)}
                className="h-full w-full border-none"
                title={document.title}
              />
            ) : (
              <iframe
                src={getEmbeddedSourceUrl(document.sourceUrl)}
                className="h-full w-full border-none"
                title={document.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              />
            )
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-600">
              No public source URL is available for this document yet. Use citation links or re-ingest with a source URL.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
        <p className="text-lg font-semibold text-[#081a30]">Indexed Key Points</p>
        <div className="mt-4 space-y-3">
          {document.insights.map((insight) => (
            <div key={insight.id} className="rounded-2xl border border-[#e2e8f0] bg-[#fbfdff] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">Key Point {insight.insightIndex + 1}</p>
              <p className="mt-2 text-sm leading-6 text-[#475569]">{insight.content}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}