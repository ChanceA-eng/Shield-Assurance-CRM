'use client';

import Link from 'next/link';
import type { Route } from 'next';
import React, { useEffect, useMemo, useRef, useState } from 'react';

interface ScopeFilters {
  carrierName?: string;
  stateContext?: string;
  policyType?: string;
}

interface RashiChatWorkspaceProps {
  title: string;
  description: string;
  scope?: ScopeFilters;
}

interface RashiDocument {
  id: string;
  title: string;
  sourceType: string;
  sourceUrl: string | null;
  carrierName: string | null;
  stateContext: string | null;
  policyType: string | null;
  topic: string | null;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
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
  topic: string | null;
}

function resolveCitationSource(citation: QueryCitation): string {
  if (citation.sourceUrl) {
    return citation.sourceUrl;
  }

  return `/rashi/document/${citation.documentId}`;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  citations?: QueryCitation[];
}

interface StatsResponse {
  documents: number;
  readyDocuments: number;
  totalInsights: number;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function getEmbeddedSourceUrl(sourceUrl: string): string {
  const normalized = sourceUrl.trim();
  const youtubeWatch = normalized.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (youtubeWatch?.[1]) {
    return `https://www.youtube.com/embed/${youtubeWatch[1]}`;
  }

  return normalized;
}

export default function RashiChatWorkspace({ title, description, scope }: RashiChatWorkspaceProps): JSX.Element {
  const [documents, setDocuments] = useState<RashiDocument[]>([]);
  const [stats, setStats] = useState<StatsResponse>({ documents: 0, readyDocuments: 0, totalInsights: 0 });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [activeSourceUrl, setActiveSourceUrl] = useState<string | null>(null);
  const [activeSourceTitle, setActiveSourceTitle] = useState<string>('Source Viewer');
  const [selectedTopic, setSelectedTopic] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const topics = useMemo(() => {
    const topicSet = new Set<string>();
    documents.forEach((document) => {
      if (document.topic) topicSet.add(document.topic);
    });

    return Array.from(topicSet).sort();
  }, [documents]);

  const loadScopedData = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (scope?.carrierName) params.set('carrierName', scope.carrierName);
    if (scope?.stateContext) params.set('stateContext', scope.stateContext);
    if (scope?.policyType) params.set('policyType', scope.policyType);
    if (selectedTopic) params.set('topic', selectedTopic);

    const [documentsResponse, statsResponse] = await Promise.all([
      fetch(`/api/rashi/documents?${params.toString()}`, { cache: 'no-store' }),
      fetch(`/api/rashi/stats?${params.toString()}`, { cache: 'no-store' }),
    ]);

    if (!documentsResponse.ok) {
      const payload = (await documentsResponse.json().catch(() => ({ message: 'Failed to load Rashi documents.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to load Rashi documents.');
      setLoading(false);
      return;
    }

    const docsPayload = (await documentsResponse.json()) as RashiDocument[];
    setDocuments(docsPayload);

    if (statsResponse.ok) {
      const statsPayload = (await statsResponse.json()) as StatsResponse;
      setStats(statsPayload);
    }

    if (!activeSourceUrl) {
      const firstSource = docsPayload.find((document) => document.sourceUrl);
      if (firstSource?.sourceUrl) {
        setActiveSourceUrl(firstSource.sourceUrl);
        setActiveSourceTitle(firstSource.title);
      }
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadScopedData();
  }, [scope?.carrierName, scope?.stateContext, scope?.policyType, selectedTopic]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const message = input.trim();
    if (!message) {
      return;
    }

    const history = messages.map((entry) => ({ role: entry.role, text: entry.text }));
    const userMessage: ChatMessage = { role: 'user', text: message };

    setMessages((current) => [...current, userMessage]);
    setInput('');
    setSending(true);
    setError(null);

    const response = await fetch('/api/rashi/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        history,
        carrierName: scope?.carrierName,
        stateContext: scope?.stateContext,
        policyType: scope?.policyType,
        topic: selectedTopic || undefined,
      }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({ message: 'Failed to chat with Rashi.' }))) as { message?: string };
      setError(payload.message ?? 'Failed to chat with Rashi.');
      setSending(false);
      return;
    }

    const payload = (await response.json()) as { answer: string; citations: QueryCitation[] };

    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: payload.answer,
        citations: payload.citations,
      },
    ]);

    const firstCitation = payload.citations[0];
    if (firstCitation) {
      setActiveSourceUrl(resolveCitationSource(firstCitation));
      setActiveSourceTitle(firstCitation.documentTitle);
    }

    setSending(false);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#dddbda] bg-[radial-gradient(circle_at_top_left,_rgba(1,118,211,0.18),_transparent_42%),linear-gradient(135deg,_#ffffff,_#edf4fb)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#0f62af]">Conversational Rashi</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#081a30]">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-[#334155]">{description}</p>
          </div>
          <div className="grid min-w-[280px] grid-cols-3 gap-3 rounded-2xl border border-white/70 bg-white/80 p-4 backdrop-blur">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#5f6b7a]">Docs</p>
              <p className="mt-1 text-xl font-bold text-[#081a30]">{stats.documents}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#5f6b7a]">Ready</p>
              <p className="mt-1 text-xl font-bold text-[#081a30]">{stats.readyDocuments}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#5f6b7a]">Key Points</p>
              <p className="mt-1 text-xl font-bold text-[#081a30]">{stats.totalInsights}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#dddbda] bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedTopic('')}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedTopic === '' ? 'bg-[#0b2545] text-white' : 'bg-[#eef3f8] text-[#0b2545]'}`}
          >
            All Topics
          </button>
          {topics.map((topic) => (
            <button
              key={topic}
              type="button"
              onClick={() => setSelectedTopic(topic)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedTopic === topic ? 'bg-[#0176d3] text-white' : 'bg-[#eef3f8] text-[#0b2545]'}`}
            >
              {topic}
            </button>
          ))}
          <Link href={'/rashi/knowledge' as Route} className="ml-auto rounded-full border border-[#c9c7c5] px-3 py-1.5 text-xs font-semibold text-[#0b2545] hover:bg-[#f8fbff]">
            Open Knowledge Manager
          </Link>
        </div>
      </section>

      <section className="grid min-h-[72vh] gap-4 xl:grid-cols-2">
        <div className="flex min-h-[72vh] flex-col overflow-hidden rounded-2xl border border-[#dddbda] bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <p className="text-lg font-semibold text-[#081a30]">Rashi Underwriting Chat</p>
            <p className="mt-1 text-xs text-[#64748b]">Ask underwriting questions naturally. Rashi answers from indexed key points only.</p>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#f8fbff] p-4">
            {messages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#cbd5e1] bg-white p-4 text-sm leading-6 text-[#475569]">
                Start the conversation with a question like: "Can we write a 22-year-old commercial roof risk in Florida?"
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'bg-[#0b2545] text-white' : 'border border-[#d8e6f6] bg-white text-[#223041]'}`}>
                      <p>{message.text}</p>
                      {message.role === 'assistant' && message.citations && message.citations.length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-xs">
                          {message.citations.slice(0, 4).map((citation, citationIndex) => (
                            <button
                              key={`${citation.documentId}-${citation.insightIndex}-${citationIndex}`}
                              type="button"
                              onClick={() => {
                                setActiveSourceUrl(resolveCitationSource(citation));
                                setActiveSourceTitle(citation.documentTitle);
                              }}
                              className="rounded-full border border-[#c9ddf4] bg-[#eef6ff] px-2.5 py-1 font-semibold text-[#0f62af] hover:bg-[#e0efff]"
                            >
                              [{citationIndex + 1}] {citation.documentTitle}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <form onSubmit={handleSendMessage} className="flex items-center gap-2 border-t border-slate-100 bg-white p-4">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about appetite, exclusions, eligibility, forms, or state requirements..."
              className="min-h-12 flex-1 rounded-xl border border-[#c9c7c5] bg-[#f8fbff] px-4 py-3 text-sm text-[#081a30] outline-none transition focus:border-[#0176d3]"
            />
            <button
              type="submit"
              disabled={sending}
              className="rounded-xl bg-[#0176d3] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#015ba1] disabled:cursor-not-allowed disabled:bg-[#8eb9df]"
            >
              {sending ? 'Thinking...' : 'Ask Rashi'}
            </button>
          </form>
        </div>

        <div className="flex min-h-[72vh] flex-col overflow-hidden rounded-2xl border border-[#dddbda] bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <p className="text-lg font-semibold text-[#081a30]">Source Viewer</p>
            <p className="mt-1 text-xs text-[#64748b]">{activeSourceTitle}</p>
          </div>

          <div className="flex-1 bg-slate-50 p-3">
            {activeSourceUrl ? (
              <iframe
                src={getEmbeddedSourceUrl(activeSourceUrl)}
                className="h-full w-full rounded-xl border border-slate-200 bg-white"
                title={activeSourceTitle}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-[#cbd5e1] bg-white p-6 text-center text-sm text-[#64748b]">
                Select a citation or document source to view the underlying asset.
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 p-3">
            <p className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">Recent Uploads</p>
            <div className="mt-2 max-h-40 space-y-2 overflow-y-auto">
              {loading ? (
                <p className="px-1 text-xs text-[#64748b]">Loading sources...</p>
              ) : documents.length === 0 ? (
                <p className="px-1 text-xs text-[#64748b]">No documents in this scope.</p>
              ) : (
                documents.slice(0, 10).map((document) => (
                  <button
                    key={document.id}
                    type="button"
                    onClick={() => {
                      setActiveSourceUrl(document.sourceUrl ?? `/rashi/document/${document.id}`);
                      setActiveSourceTitle(document.title);
                    }}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-[#fbfdff] px-3 py-2 text-left text-xs text-[#334155] transition hover:border-[#0176d3]"
                  >
                    <p className="font-semibold text-[#081a30]">{document.title}</p>
                    <p className="mt-1 text-[#64748b]">{document.sourceType} · {document.status} · {formatDate(document.updatedAt)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
    </div>
  );
}
