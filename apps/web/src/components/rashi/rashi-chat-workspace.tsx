'use client';

import Link from 'next/link';
import type { Route } from 'next';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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

function resolveCitationSource(citation: QueryCitation): string | null {
  if (!citation.sourceUrl) {
    return null;
  }

  return `/api/rashi/documents/${citation.documentId}/view`;
}

function resolveDocumentSource(document: RashiDocument): string | null {
  if (!document.sourceUrl) {
    return null;
  }

  return `/api/rashi/documents/${document.id}/view`;
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

type HighlightKind = 'LIMIT' | 'DEDUCTIBLE' | 'FORM' | 'STATUS';

const HIGHLIGHT_TOKEN_REGEX = /\[(LIMIT|DEDUCTIBLE|FORM|STATUS):\s*([^\]]+?)\]/g;
const INLINE_CITATION_REGEX = /\[(\d+)\](?!\()/g;

function withInlineCitationLinks(text: string): string {
  return text.replace(INLINE_CITATION_REGEX, '[cite $1](citation:$1)');
}

function badgeClasses(kind: HighlightKind): string {
  switch (kind) {
    case 'LIMIT':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    case 'DEDUCTIBLE':
      return 'border-sky-300 bg-sky-50 text-sky-700';
    case 'FORM':
      return 'border-amber-300 bg-amber-50 text-amber-700';
    case 'STATUS':
      return 'border-violet-300 bg-violet-50 text-violet-700';
    default:
      return 'border-slate-300 bg-slate-50 text-slate-700';
  }
}

function renderTextWithHighlights(text: string, keyPrefix: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(HIGHLIGHT_TOKEN_REGEX)) {
    const matchIndex = match.index ?? 0;
    const fullToken = match[0];
    const tokenType = match[1] as HighlightKind;
    const tokenValue = match[2]?.trim() ?? '';

    if (matchIndex > lastIndex) {
      result.push(text.slice(lastIndex, matchIndex));
    }

    result.push(
      <span
        key={`${keyPrefix}-${matchIndex}`}
        className={`mx-0.5 inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${badgeClasses(tokenType)}`}
      >
        {tokenValue}
      </span>,
    );

    lastIndex = matchIndex + fullToken.length;
  }

  if (lastIndex < text.length) {
    result.push(text.slice(lastIndex));
  }

  return result.length > 0 ? result : [text];
}

function renderNodeWithHighlights(node: React.ReactNode, keyPrefix: string): React.ReactNode {
  if (typeof node === 'string') {
    return renderTextWithHighlights(node, keyPrefix);
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => renderNodeWithHighlights(child, `${keyPrefix}-${index}`));
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    return React.cloneElement(element, {
      key: `${keyPrefix}-node`,
      children: renderNodeWithHighlights(element.props.children, `${keyPrefix}-child`),
    });
  }

  return node;
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

const RASHI_GREETING: ChatMessage = {
  role: 'assistant',
  text: 'Shalom! I am Rashi, your underwriting intelligence assistant. Ask me about carrier appetite, exclusions, eligibility, state requirements, or any coverage question — I\'ll answer based on your indexed knowledge base.',
};

function generateSessionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function RashiChatWorkspace({ title, description, scope }: RashiChatWorkspaceProps): JSX.Element {
  const [documents, setDocuments] = useState<RashiDocument[]>([]);
  const [stats, setStats] = useState<StatsResponse>({ documents: 0, readyDocuments: 0, totalInsights: 0 });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([RASHI_GREETING]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string>(() => generateSessionId());
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
      const firstSource = docsPayload.find((document) => Boolean(document.sourceUrl));
      const resolvedSourceUrl = firstSource ? resolveDocumentSource(firstSource) : null;
      if (firstSource && resolvedSourceUrl) {
        setActiveSourceUrl(resolvedSourceUrl);
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

  const handleCitationOpen = (
    event: React.MouseEvent<HTMLButtonElement>,
    citation: QueryCitation,
  ): void => {
    event.preventDefault();
    event.stopPropagation();

    const sourceUrl = resolveCitationSource(citation);
    if (!sourceUrl) {
      return;
    }

    setActiveSourceUrl(sourceUrl);
    setActiveSourceTitle(citation.documentTitle);
  };

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
        sessionId,
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

    const payload = (await response.json()) as { answer: string; citations: QueryCitation[]; sessionId?: string };

    if (payload.sessionId) {
      setSessionId(payload.sessionId);
    }

    setMessages((current) => [
      ...current,
      {
        role: 'assistant',
        text: payload.answer,
        citations: payload.citations,
      },
    ]);

    const firstCitation = payload.citations.find((citation) => Boolean(resolveCitationSource(citation)));
    const resolvedCitationSourceUrl = firstCitation ? resolveCitationSource(firstCitation) : null;
    if (resolvedCitationSourceUrl && firstCitation) {
      setActiveSourceUrl(resolvedCitationSourceUrl);
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
          <div className="flex items-center justify-between border-b border-slate-100 p-4">
            <div>
              <p className="text-lg font-semibold text-[#081a30]">Rashi Underwriting Chat</p>
              <p className="mt-1 text-xs text-[#64748b]">Rashi answers from your indexed knowledge base. Follow-up questions retain full context.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMessages([RASHI_GREETING]);
                setSessionId(generateSessionId());
              }}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
            >
              New Thread
            </button>
          </div>

          <div className="flex-1 overflow-y-auto bg-[#f8fbff] p-4">
            <div className="space-y-3">
              {messages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'bg-[#0b2545] text-white' : 'border border-[#d8e6f6] bg-white text-[#223041]'}`}>
                    {message.role === 'assistant' ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => <p className="my-1.5 leading-6">{renderNodeWithHighlights(children, `p-${index}`)}</p>,
                          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
                          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
                          li: ({ children }) => <li>{renderNodeWithHighlights(children, `li-${index}`)}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-[#0b2545]">{renderNodeWithHighlights(children, `strong-${index}`)}</strong>,
                          h1: ({ children }) => <h3 className="mb-1 mt-2 text-base font-semibold text-[#081a30]">{renderNodeWithHighlights(children, `h1-${index}`)}</h3>,
                          h2: ({ children }) => <h3 className="mb-1 mt-2 text-base font-semibold text-[#081a30]">{renderNodeWithHighlights(children, `h2-${index}`)}</h3>,
                          h3: ({ children }) => <h4 className="mb-1 mt-2 text-sm font-semibold text-[#081a30]">{renderNodeWithHighlights(children, `h3-${index}`)}</h4>,
                          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-slate-300 pl-3 text-[#334155]">{renderNodeWithHighlights(children, `quote-${index}`)}</blockquote>,
                          code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-xs text-slate-700">{children}</code>,
                          a: ({ href, children }) => {
                            if (href?.startsWith('citation:')) {
                              const citationNumber = Number(href.split(':')[1]);
                              const citation = Number.isFinite(citationNumber)
                                ? message.citations?.[citationNumber - 1]
                                : undefined;

                              if (!citation || !Number.isFinite(citationNumber) || citationNumber < 1) {
                                return <span className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-600">[{children}]</span>;
                              }

                              return (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    handleCitationOpen(event, citation);
                                  }}
                                  className="mx-0.5 inline-flex items-center rounded border border-[#b8d6f6] bg-[#eaf4ff] px-1.5 py-0.5 text-xs font-bold text-[#0f62af] hover:bg-[#dceeff]"
                                  title={`Open source: ${citation.documentTitle}`}
                                >
                                  [{citationNumber}]
                                </button>
                              );
                            }

                            return (
                              <a href={href} target="_blank" rel="noreferrer" className="text-[#0f62af] underline decoration-[#0f62af]/40 underline-offset-2 hover:text-[#015ba1]">
                                {children}
                              </a>
                            );
                          },
                        }}
                      >
                        {withInlineCitationLinks(message.text)}
                      </ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.text}</p>
                    )}
                    {message.role === 'assistant' && message.citations && message.citations.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs">
                        {message.citations.slice(0, 4).map((citation, citationIndex) => (
                          <button
                            key={`${citation.documentId}-${citation.insightIndex}-${citationIndex}`}
                            type="button"
                            disabled={!citation.sourceUrl}
                            onClick={(event) => {
                              handleCitationOpen(event, citation);
                            }}
                            className="rounded-full border border-[#c9ddf4] bg-[#eef6ff] px-2.5 py-1 font-semibold text-[#0f62af] hover:bg-[#e0efff] disabled:cursor-not-allowed disabled:opacity-50"
                            title={citation.sourceUrl ? citation.documentTitle : `${citation.documentTitle} has no source asset URL`}
                          >
                            [{citationIndex + 1}] {citation.documentTitle}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              {sending ? (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-[#d8e6f6] bg-white px-5 py-3 text-sm text-[#64748b]">
                    <span className="inline-flex gap-1">
                      <span className="animate-bounce" style={{ animationDelay: '0ms' }}>●</span>
                      <span className="animate-bounce" style={{ animationDelay: '150ms' }}>●</span>
                      <span className="animate-bounce" style={{ animationDelay: '300ms' }}>●</span>
                    </span>
                  </div>
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>
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
                    disabled={!document.sourceUrl}
                    onClick={() => {
                      const sourceUrl = resolveDocumentSource(document);
                      if (!sourceUrl) {
                        return;
                      }

                      setActiveSourceUrl(sourceUrl);
                      setActiveSourceTitle(document.title);
                    }}
                    className="w-full rounded-lg border border-[#e2e8f0] bg-[#fbfdff] px-3 py-2 text-left text-xs text-[#334155] transition hover:border-[#0176d3] disabled:cursor-not-allowed disabled:opacity-55"
                    title={document.sourceUrl ? document.title : `${document.title} has no source asset URL`}
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
