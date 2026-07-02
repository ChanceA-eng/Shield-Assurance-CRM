'use client';

import Link from 'next/link';
import type { Route } from 'next';
import React, { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  label: string;
  answer: string;
  citations: QueryCitation[];
}

interface AnalyzeResponse {
  documentId: string;
  documentTitle: string;
  action: 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';
  currentActionLabel?: string;
  summary: string;
  citations: Array<{
    documentId: string;
    documentTitle: string;
    sourceType: string;
    sourceUrl: string | null;
  }>;
}

type QuickActionId = 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';

const quickActions: Array<{ id: QuickActionId; label: string; prompt: string }> = [
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
];

export default function RashiDocumentView({ documentId }: { documentId: string }): JSX.Element {
  const [document, setDocument] = useState<KnowledgeDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [reingesting, setReingesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeActionResult, setActiveActionResult] = useState<QueryResponse | null>(null);
  const [activeAction, setActiveAction] = useState<QuickActionId | null>(null);
  const [attachingFile, setAttachingFile] = useState(false);

  useEffect(() => {
    const loadDocument = async (): Promise<void> => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/rashi/documents/${documentId}`, { cache: 'no-store' });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({ message: 'Failed to load document.' }))) as { message?: string };
          setError(payload.message ?? 'Failed to load document.');
          return;
        }

        const payload = (await response.json()) as KnowledgeDocument;
        setDocument(payload);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load document.');
      } finally {
        setLoading(false);
      }
    };

    void loadDocument();
  }, [documentId]);

  const runQuickAction = async (action: QuickActionId, actionPrompt: string): Promise<void> => {
    setQuerying(true);
    setActiveAction(action);
    setError(null);

    try {
      const response = await fetch('/api/rashi/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: action, documentId }),
        signal: AbortSignal.timeout(45000),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Failed to run extraction.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to run extraction.');
        return;
      }

      const payload = (await response.json()) as AnalyzeResponse;

      const queryProxy: QueryResponse = {
        question: actionPrompt,
        label: payload.currentActionLabel ?? 'Analysis',
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

      setActiveActionResult(queryProxy);
      await refreshDocument();
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Extraction workflow failed.');
    } finally {
      setQuerying(false);
      setActiveAction(null);
    }
  };

  const handleReingest = async (): Promise<void> => {
    setReingesting(true);
    setError(null);

    try {
      const response = await fetch(`/api/rashi/documents/${documentId}/reingest`, {
        method: 'POST',
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Failed to re-ingest document.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to re-ingest document.');
        return;
      }

      const refreshed = await fetch(`/api/rashi/documents/${documentId}`, { cache: 'no-store' });
      if (refreshed.ok) {
        const payload = (await refreshed.json()) as KnowledgeDocument;
        setDocument(payload);
      }
    } catch (reingestError) {
      setError(reingestError instanceof Error ? reingestError.message : 'Failed to re-ingest document.');
    } finally {
      setReingesting(false);
    }
  };

  const refreshDocument = async (): Promise<void> => {
    const refreshed = await fetch(`/api/rashi/documents/${documentId}`, { cache: 'no-store' });
    if (refreshed.ok) {
      const payload = (await refreshed.json()) as KnowledgeDocument;
      setDocument(payload);
    }
  };

  const handleAttachFile = async (file: File): Promise<void> => {
    if (!file) {
      return;
    }

    setAttachingFile(true);
    setError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`/api/rashi/documents/${documentId}/source-file`, {
        method: 'PATCH',
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Failed to attach source file.' }))) as { message?: string };
        setError(payload.message ?? 'Failed to attach source file.');
        return;
      }

      await refreshDocument();
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : 'Failed to attach source file.');
    } finally {
      setAttachingFile(false);
    }
  };

  const getEmbeddedSourceUrl = (sourceUrl: string): string => {
    const normalized = sourceUrl.trim();
    const youtubeWatch = normalized.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
    if (youtubeWatch?.[1]) {
      return `https://www.youtube.com/embed/${youtubeWatch[1]}`;
    }

    return normalized;
  };

  const isVideoAsset = (documentSourceType: string, sourceUrl: string | null): boolean => {
    if (documentSourceType === 'VIDEO_TRANSCRIPT') {
      return true;
    }

    if (!sourceUrl) {
      return false;
    }

    const normalized = sourceUrl.toLowerCase();
    return (
      normalized.endsWith('.mp4')
      || normalized.includes('youtube.com/watch')
      || normalized.includes('youtu.be/')
      || normalized.includes('vimeo.com/')
      || normalized.includes('/embed/')
    );
  };

  const statusBadgeClassName = (status: KnowledgeDocument['status']): string => {
    if (status === 'READY') return 'bg-green-50 text-green-700';
    if (status === 'FAILED') return 'bg-red-50 text-red-700';
    return 'bg-amber-50 text-amber-700';
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

  const embeddedSourceUrl = document.sourceUrl ? getEmbeddedSourceUrl(document.sourceUrl) : null;
  const viewerUrl = document.sourceUrl ? `/api/rashi/documents/${documentId}/view` : null;
  const isVideo = isVideoAsset(document.sourceType, embeddedSourceUrl);

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col space-y-6 bg-white p-6">
      <header className="flex items-center justify-between border-b border-gray-100 pb-4">
        <div className="flex items-center gap-3">
          <Link
            href={'/rashi' as Route}
            className="text-sm font-medium text-gray-400 transition-colors hover:text-gray-900"
            title="Back to Knowledge Center"
          >
            ← Back
          </Link>
          <span className="text-gray-200">|</span>
          <h2 className="text-xl font-bold text-gray-900">{document.title}</h2>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-semibold uppercase text-gray-700">
            {document.sourceType}
          </span>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${statusBadgeClassName(document.status)}`}>
            Status: {document.status}
          </span>
        </div>
      </header>

      <section className="grid min-h-[650px] flex-1 grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          <div className="flex items-center justify-between border-b border-gray-100 bg-white p-3">
            <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Attached Source Asset</span>
            {document.sourceUrl ? (
              <a
                href={document.sourceUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Download Original File
              </a>
            ) : null}
          </div>

          <div className="h-full min-h-[600px] flex-1 bg-gray-100">
            {embeddedSourceUrl ? (
              isVideo ? (
                <video src={embeddedSourceUrl} controls className="h-full max-h-[600px] w-full bg-black" />
              ) : (
                <iframe
                  src={`${viewerUrl ?? embeddedSourceUrl}#toolbar=1`}
                  className="h-full min-h-[600px] w-full border-none"
                  title="Asset File Viewer"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              )
            ) : (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center text-sm text-gray-400">
                <p className="font-medium text-gray-500">No source file bound to this reference.</p>
                <label className="mt-2 cursor-pointer text-xs font-semibold text-blue-600 hover:underline">
                  {attachingFile ? 'Attaching file...' : 'Attach Original PDF File'}
                  <input
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    disabled={attachingFile}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleAttachFile(file);
                      }
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {document.status === 'FAILED' ? (
                  <p className="mt-2 text-xs text-rose-600">{document.errorMessage ?? 'Asset parsing failed. Re-ingest after updating the source.'}</p>
                ) : null}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col space-y-6">
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">Underwriting Actions</h3>
            <div className="grid grid-cols-2 gap-2">
              {quickActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => void runQuickAction(action.id, action.prompt)}
                  disabled={querying || reingesting}
                  className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-left text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {querying && activeAction === action.id ? 'Running...' : action.label}
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
              <span>{document.insights.length} indexed key points</span>
              <button
                type="button"
                onClick={() => void handleReingest()}
                disabled={reingesting || querying}
                className="font-semibold text-blue-600 hover:underline disabled:cursor-not-allowed disabled:text-gray-400"
              >
                {reingesting ? 'Re-ingesting...' : 'Re-generate'}
              </button>
            </div>
          </div>

          {activeActionResult ? (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="mb-4 border-b border-gray-100 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                  {activeActionResult.label || 'Analysis'}
                </h3>
              </div>

              <div className="space-y-3 text-sm leading-relaxed text-gray-700">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p className="my-1 whitespace-pre-wrap">{children}</p>,
                    ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
                    li: ({ children }) => <li className="my-1">{children}</li>,
                    strong: ({ children }) => <strong className="rounded bg-yellow-50 px-1 font-bold text-gray-950">{children}</strong>,
                  }}
                >
                  {activeActionResult.answer}
                </ReactMarkdown>
              </div>

              {activeActionResult.citations.length > 0 ? (
                <div className="mt-3 space-y-2 border-t border-blue-100 pt-3">
                  {activeActionResult.citations.map((citation) => (
                    <p key={`${citation.documentId}-${citation.insightIndex}`} className="text-xs font-medium text-blue-700">
                      {citation.documentTitle}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-1 flex-col rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-gray-400">Indexed Document Text</h3>
              <span className="text-[10px] font-medium text-gray-400">Source Text Context</span>
            </div>

            <div className="max-h-[380px] flex-1 space-y-3 overflow-y-auto pr-2 text-xs leading-relaxed text-gray-600">
              <div className="space-y-2 pt-1">
                {document.insights.map((insight) => (
                  <div key={insight.id} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Key Point {insight.insightIndex + 1}</p>
                    <p className="mt-1 leading-relaxed text-gray-700">{insight.content}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
