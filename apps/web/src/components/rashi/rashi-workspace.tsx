'use client';

import Link from 'next/link';
import type { Route } from 'next';
import React, { useEffect, useMemo, useState } from 'react';

interface RashiDocument {
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
  _count?: { insights: number };
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
  topic?: string | null;
}

interface QueryResponse {
  question: string;
  answer: string;
  citations: QueryCitation[];
}

interface ScopeFilters {
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
}

interface RashiWorkspaceProps {
  title: string;
  description: string;
  scope?: ScopeFilters;
}

interface UploadFormState {
  title: string;
  sourceType: 'PDF' | 'ARTICLE' | 'LINK' | 'VIDEO_TRANSCRIPT' | 'NOTE';
  sourceUrl: string;
  rawText: string;
  carrierName: string;
  stateContext: string;
  policyType: string;
  topic: string;
}

interface StatsResponse {
  documents: number;
  readyDocuments: number;
  totalInsights: number;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export default function RashiWorkspace({ title, description, scope }: RashiWorkspaceProps): JSX.Element {
  const [documents, setDocuments] = useState<RashiDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [querying, setQuerying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [selectedTopic, setSelectedTopic] = useState('');
  const [answer, setAnswer] = useState<QueryResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse>({ documents: 0, readyDocuments: 0, totalInsights: 0 });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [form, setForm] = useState<UploadFormState>({
    title: '',
    sourceType: 'PDF',
    sourceUrl: '',
    rawText: '',
    carrierName: scope?.carrierName ?? '',
    stateContext: scope?.stateContext ?? '',
    policyType: scope?.policyType ?? '',
    topic: '',
  });

  const isPdfMode = form.sourceType === 'PDF';
  const isUrlMode = form.sourceType === 'ARTICLE' || form.sourceType === 'LINK' || form.sourceType === 'VIDEO_TRANSCRIPT';
  const isTextMode = form.sourceType === 'NOTE' || form.sourceType === 'ARTICLE' || form.sourceType === 'VIDEO_TRANSCRIPT';

  const loadDocuments = async (topicFilter: string): Promise<void> => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (scope?.carrierName) params.set('carrierName', scope.carrierName);
    if (scope?.stateContext) params.set('stateContext', scope.stateContext);
    if (scope?.policyType) params.set('policyType', scope.policyType);
    if (topicFilter) params.set('topic', topicFilter);

    const response = await fetch(`/api/rashi/documents?${params.toString()}`, { cache: 'no-store' });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to load Rashi documents.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to load Rashi documents.');
      setLoading(false);
      return;
    }

    const payload = (await response.json()) as RashiDocument[];
    setDocuments(payload);
    setLoading(false);
  };

  useEffect(() => {
    void loadDocuments(selectedTopic);
  }, [selectedTopic, scope?.carrierName, scope?.policyType, scope?.stateContext]);

  useEffect(() => {
    const loadStats = async (): Promise<void> => {
      const params = new URLSearchParams();
      if (scope?.carrierName) params.set('carrierName', scope.carrierName);
      if (scope?.stateContext) params.set('stateContext', scope.stateContext);
      if (scope?.policyType) params.set('policyType', scope.policyType);
      if (selectedTopic) params.set('topic', selectedTopic);

      const response = await fetch(`/api/rashi/stats?${params.toString()}`, { cache: 'no-store' });
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as StatsResponse;
      setStats(payload);
    };

    void loadStats();
  }, [selectedTopic, scope?.carrierName, scope?.policyType, scope?.stateContext]);

  const tags = useMemo(() => {
    const carrierSet = new Set<string>();
    const stateSet = new Set<string>();
    const policySet = new Set<string>();
    const topicSet = new Set<string>();

    documents.forEach((document) => {
      if (document.carrierName) carrierSet.add(document.carrierName);
      if (document.stateContext) stateSet.add(document.stateContext);
      if (document.policyType) policySet.add(document.policyType);
      if (document.topic) topicSet.add(document.topic);
      document.topicTags.forEach((tag) => topicSet.add(tag));
    });

    return {
      carriers: Array.from(carrierSet).sort(),
      states: Array.from(stateSet).sort(),
      policies: Array.from(policySet).sort(),
      topics: Array.from(topicSet).sort(),
    };
  }, [documents]);

  const submitQuestion = async (nextQuestion: string): Promise<void> => {
    const trimmed = nextQuestion.trim();
    if (!trimmed) {
      setError('Ask Rashi a question first.');
      return;
    }

    setQuerying(true);
    setError(null);

    const response = await fetch('/api/rashi/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: trimmed,
        carrierName: scope?.carrierName,
        stateContext: scope?.stateContext,
        policyType: scope?.policyType,
        topic: selectedTopic || undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to query Rashi.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to query Rashi.');
      setQuerying(false);
      return;
    }

    const payload = (await response.json()) as QueryResponse;
    setAnswer(payload);
    setQuerying(false);
  };

  const handleCreateDocument = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    if (isPdfMode && !uploadFile && !form.rawText.trim()) {
      setError('PDF mode requires a PDF/TXT file upload or pasted extracted text.');
      setSubmitting(false);
      return;
    }

    if (isUrlMode && !form.sourceUrl.trim() && !form.rawText.trim()) {
      setError('Link and video modes require a source URL or pasted text.');
      setSubmitting(false);
      return;
    }

    if (form.sourceType === 'NOTE' && !form.rawText.trim()) {
      setError('Notes mode requires pasted text.');
      setSubmitting(false);
      return;
    }

    const response = isPdfMode && uploadFile
      ? await (async () => {
          const payload = new FormData();
          payload.append('title', form.title);
          payload.append('sourceType', form.sourceType);
          if (form.rawText.trim()) payload.append('rawText', form.rawText.trim());
          if (form.sourceUrl.trim()) payload.append('sourceUrl', form.sourceUrl.trim());
          payload.append('carrierName', form.carrierName);
          payload.append('stateContext', form.stateContext);
          payload.append('policyType', form.policyType);
          payload.append('topic', form.topic);
          payload.append('file', uploadFile);

          return fetch('/api/rashi/ingest', {
            method: 'POST',
            body: payload,
          });
        })()
      : await fetch('/api/rashi/ingest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: form.title,
            sourceType: form.sourceType,
            ...(isUrlMode && form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl.trim() } : {}),
            ...(isTextMode && form.rawText.trim() ? { rawText: form.rawText.trim() } : {}),
            carrierName: form.carrierName || undefined,
            stateContext: form.stateContext || undefined,
            policyType: form.policyType || undefined,
            topic: form.topic || undefined,
          }),
        });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to create Rashi document.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to create Rashi document.');
      setSubmitting(false);
      return;
    }

    setForm((current) => ({
      ...current,
      title: '',
      sourceUrl: '',
      rawText: '',
      topic: '',
    }));
    setUploadFile(null);
    setSubmitting(false);
    await loadDocuments(selectedTopic);
  };

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-[#dddbda] bg-[radial-gradient(circle_at_top_left,_rgba(1,118,211,0.18),_transparent_38%),linear-gradient(135deg,_#ffffff,_#edf4fb)] p-6 shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#0f62af]">Retrieval-Augmented Shield Intelligence</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#081a30]">{title}</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#334155]">{description}</p>
          </div>
          <div className="grid min-w-[280px] grid-cols-2 gap-3 rounded-2xl border border-white/70 bg-white/80 p-4 backdrop-blur">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#5f6b7a]">Documents</p>
              <p className="mt-1 text-2xl font-bold text-[#081a30]">{stats.documents}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#5f6b7a]">Ready Key Points</p>
              <p className="mt-1 text-2xl font-bold text-[#081a30]">{stats.totalInsights}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.45fr_0.95fr]">
        <div className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row">
            <input
              type="text"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask Rashi anything about appetite, regulations, coverage, or exclusions..."
              className="min-h-12 flex-1 rounded-xl border border-[#c9c7c5] bg-[#f8fbff] px-4 py-3 text-sm text-[#081a30] outline-none ring-0 transition focus:border-[#0176d3]"
            />
            <button
              type="button"
              onClick={() => void submitQuestion(question)}
              disabled={querying}
              className="rounded-xl bg-[#0176d3] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#015ba1] disabled:cursor-not-allowed disabled:bg-[#8eb9df]"
            >
              {querying ? 'Consulting...' : 'Consult Rashi'}
            </button>
          </div>

          {answer ? (
            <div className="mt-5 rounded-2xl border border-[#d8e6f6] bg-[#f6fbff] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#0f62af]">Response</p>
              <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-6 text-[#223041]">{answer.answer}</pre>
              <div className="mt-4 space-y-3">
                {answer.citations.map((citation) => (
                  <div
                    key={`${citation.documentId}-${citation.insightIndex}`}
                    className="rounded-xl border border-[#d8e6f6] bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-[#081a30]">{citation.documentTitle}</p>
                      <span className="text-xs font-semibold text-[#0f62af]">Score {citation.score.toFixed(2)}</span>
                    </div>
                    <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[#64748b]">
                      Key Point {citation.insightIndex + 1} · {citation.sourceType}
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
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4 text-sm leading-6 text-[#475569]">
              Ask a scoped underwriting question and Rashi will return an answer grounded in your uploaded knowledge with citations.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {(['PDF', 'ARTICLE', 'LINK', 'VIDEO_TRANSCRIPT', 'NOTE'] as UploadFormState['sourceType'][]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  setForm((current) => ({ ...current, sourceType: type }));
                  setUploadFile(null);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  form.sourceType === type ? 'bg-[#0b2545] text-white' : 'bg-[#eef3f8] text-[#0b2545] hover:bg-[#dbe8f4]'
                }`}
              >
                {type === 'VIDEO_TRANSCRIPT' ? 'Video Link' : type}
              </button>
            ))}
          </div>

          <form onSubmit={handleCreateDocument} className="mt-4 space-y-3">
            <input
              required
              type="text"
              placeholder="Document title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              className="w-full rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
            />
            {isPdfMode ? (
              <div className="rounded-xl border border-dashed border-[#c9c7c5] bg-[#f8fbff] p-3">
                <label className="block text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">PDF Upload</label>
                <input
                  type="file"
                  accept=".pdf,.txt"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  className="mt-2 block w-full text-sm text-[#334155] file:mr-4 file:rounded-full file:border-0 file:bg-[#0b2545] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white"
                />
                <p className="mt-2 text-xs leading-5 text-[#64748b]">
                  Upload a PDF/TXT file. Optional: paste extracted text below to override file extraction.
                </p>
              </div>
            ) : null}

            {isUrlMode ? (
              <input
                type="url"
                placeholder={form.sourceType === 'VIDEO_TRANSCRIPT' ? 'Video URL or transcript link' : 'Article or source URL'}
                value={form.sourceUrl}
                onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))}
                className="w-full rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
              />
            ) : null}

            {isTextMode || isPdfMode ? (
              <textarea
                rows={8}
                placeholder={
                  form.sourceType === 'NOTE'
                    ? 'Paste your underwriting notes...'
                    : form.sourceType === 'VIDEO_TRANSCRIPT'
                      ? 'Paste transcript text (or rely on linked source if available)...'
                      : 'Paste extracted text...'
                }
                value={form.rawText}
                onChange={(event) => setForm((current) => ({ ...current, rawText: event.target.value }))}
                className="w-full rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
              />
            ) : null}
            <div className="grid gap-3 md:grid-cols-3">
              <input
                type="text"
                placeholder="Carrier"
                value={form.carrierName}
                onChange={(event) => setForm((current) => ({ ...current, carrierName: event.target.value }))}
                className="rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
              />
              <input
                type="text"
                placeholder="State"
                value={form.stateContext}
                onChange={(event) => setForm((current) => ({ ...current, stateContext: event.target.value.toUpperCase() }))}
                className="rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
              />
              <input
                type="text"
                placeholder="Policy Type"
                value={form.policyType}
                onChange={(event) => setForm((current) => ({ ...current, policyType: event.target.value.toUpperCase() }))}
                className="rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
              />
            </div>
            <input
              type="text"
              placeholder="Topic"
              value={form.topic}
              onChange={(event) => setForm((current) => ({ ...current, topic: event.target.value }))}
              className="w-full rounded-xl border border-[#c9c7c5] px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[#0b2545] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#13335c] disabled:cursor-not-allowed disabled:bg-[#56708b]"
            >
              {submitting ? 'Queueing Ingest...' : 'Add to Rashi'}
            </button>
          </form>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}

      <section className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
        <h3 className="mb-4 text-lg font-semibold text-[#081a30]">Knowledge Categories</h3>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Carriers</p>
            {tags.carriers.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {tags.carriers.map((carrier) => (
                  <li key={carrier}>
                    <Link href={`/rashi/carrier/${slugify(carrier)}` as Route} className="text-sm text-[#0f62af] hover:underline">
                      {carrier}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#94a3b8]">None yet</p>
            )}
          </div>

          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#64748b]">States</p>
            {tags.states.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {tags.states.map((state) => (
                  <li key={state}>
                    <Link href={`/rashi/state/${slugify(state)}` as Route} className="text-sm text-[#0f62af] hover:underline">
                      {state}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#94a3b8]">None yet</p>
            )}
          </div>

          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Policy Types</p>
            {tags.policies.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {tags.policies.map((policy) => (
                  <li key={policy}>
                    <Link href={`/rashi/policy/${slugify(policy)}` as Route} className="text-sm text-[#0f62af] hover:underline">
                      {policy}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#94a3b8]">None yet</p>
            )}
          </div>

          <div className="rounded-xl border border-[#e2e8f0] bg-[#f8fbff] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-[#64748b]">Topics</p>
            {tags.topics.length > 0 ? (
              <ul className="mt-2 space-y-1">
                <li>
                  <button
                    type="button"
                    onClick={() => setSelectedTopic('')}
                    className={`text-left text-sm hover:underline ${selectedTopic === '' ? 'font-semibold text-[#0176d3]' : 'text-[#0f62af]'}`}
                  >
                    All Topics
                  </button>
                </li>
                {tags.topics.map((topic) => (
                  <li key={topic}>
                    <button
                      type="button"
                      onClick={() => setSelectedTopic(topic)}
                      className={`text-left text-sm hover:underline ${selectedTopic === topic ? 'font-semibold text-[#0176d3]' : 'text-[#0f62af]'}`}
                    >
                      {topic}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-[#94a3b8]">None yet</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#dddbda] bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-lg font-semibold text-[#081a30]">Recent Uploads</p>
            <p className="text-sm text-[#64748b]">Latest knowledge assets indexed for underwriting answers.</p>
          </div>
        </div>

        {loading ? <p className="mt-4 text-sm text-[#64748b]">Loading knowledge documents...</p> : null}

        {!loading && documents.length === 0 ? (
          <div className="mt-4 rounded-2xl border border-dashed border-[#cbd5e1] bg-[#f8fafc] p-4 text-sm text-[#475569]">
            No knowledge documents match this scope yet.
          </div>
        ) : null}

        {!loading && documents.length > 0 ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {documents.map((document) => (
              <Link
                key={document.id}
                href={`/rashi/document/${document.id}` as Route}
                className="rounded-2xl border border-[#e2e8f0] bg-[#fbfdff] p-4 transition hover:border-[#0176d3]"
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#081a30]">{document.title}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[#64748b]">{document.sourceType} · {document.status}</p>
                  </div>
                  <div className="rounded-full bg-[#eef3f8] px-3 py-1 text-xs font-semibold text-[#0b2545]">
                    {document._count?.insights ?? 0} key points
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-[#475569]">{document.summary ?? 'Queued for processing.'}</p>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">
                  Source: {document.sourceType}{document.sourceUrl ? ' · Linked Source Available' : ''}
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {document.carrierName ? <span className="rounded-full bg-[#e8f1fb] px-2.5 py-1 font-semibold text-[#0f62af]">{document.carrierName}</span> : null}
                  {document.stateContext ? <span className="rounded-full bg-[#eef2ff] px-2.5 py-1 font-semibold text-[#3730a3]">{document.stateContext}</span> : null}
                  {document.policyType ? <span className="rounded-full bg-[#ecfccb] px-2.5 py-1 font-semibold text-[#3f6212]">{document.policyType}</span> : null}
                  {document.topic ? <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 font-semibold text-[#475569]">{document.topic}</span> : null}
                </div>
                <p className="mt-3 text-xs text-[#64748b]">Updated {formatDate(document.updatedAt)}</p>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}