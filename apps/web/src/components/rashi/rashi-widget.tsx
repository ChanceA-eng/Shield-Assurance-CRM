'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WidgetMessage {
  role: 'user' | 'assistant';
  content: string;
}

type InsightTab = 'alerts' | 'bundles';

interface AnalyzeRequestContext {
  label: string;
  payload: {
    leadId?: string;
    clientId?: string;
    commercialAccountId?: string;
    personalAccountId?: string;
  };
}

interface AnalyzeResponsePayload {
  alerts?: string[];
  bundles?: string[];
  prospect?: {
    displayName?: string;
    prospectType?: string;
  };
  message?: string;
}

function generateSessionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function splitPath(pathname: string): string[] {
  return pathname.split('/').filter(Boolean);
}

function parseAnalyzeContext(pathname: string, search: string): AnalyzeRequestContext | null {
  const segments = splitPath(pathname);
  const params = new URLSearchParams(search);

  if (segments[0] === 'clients' && segments[1] && segments[1] !== 'workspace') {
    return {
      label: `Client ${segments[1]}`,
      payload: { clientId: segments[1] },
    };
  }

  if (segments[0] === 'clients' && segments[1] === 'workspace') {
    const leadId = params.get('lead')?.trim();
    if (leadId) {
      return {
        label: `Lead ${leadId}`,
        payload: { leadId },
      };
    }
  }

  if (segments[0] === 'commercial' && segments[1] === 'intake') {
    const commercialAccountId = params.get('id')?.trim();
    if (commercialAccountId) {
      return {
        label: `Commercial ${commercialAccountId}`,
        payload: { commercialAccountId },
      };
    }
  }

  const leadId = params.get('leadId')?.trim();
  if (leadId) {
    return {
      label: `Lead ${leadId}`,
      payload: { leadId },
    };
  }

  const clientId = params.get('clientId')?.trim();
  if (clientId) {
    return {
      label: `Client ${clientId}`,
      payload: { clientId },
    };
  }

  const personalAccountId = params.get('personalAccountId')?.trim();
  if (personalAccountId) {
    return {
      label: `Personal ${personalAccountId}`,
      payload: { personalAccountId },
    };
  }

  return null;
}

function uniqueItems(items: string[] | undefined): string[] {
  return Array.from(new Set((items ?? []).map((item) => item.trim()).filter(Boolean)));
}

function InlineMd({ children: text }: { children: string }): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children: nodes }) => <>{nodes}</>,
        strong: ({ children: nodes }) => (
          <strong className="rounded bg-blue-100 px-0.5 font-bold text-[#0f62af]">{nodes}</strong>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

export default function RashiWidget(): JSX.Element {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <></>;
  }

  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => generateSessionId());
  const [insightTab, setInsightTab] = useState<InsightTab>('alerts');
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);
  const [bundles, setBundles] = useState<string[]>([]);
  const [targetLabel, setTargetLabel] = useState<string>('');
  const [search, setSearch] = useState('');
  const [lastAnalyzedKey, setLastAnalyzedKey] = useState<string>('');

  const greeting = useMemo<WidgetMessage>(
    () => ({
      role: 'assistant',
      content: 'Ask an underwriting question to get a focused, line-by-line answer.',
    }),
    [],
  );

  const visibleMessages = messages.length > 0 ? messages : [greeting];

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    setSearch(window.location.search ?? '');
  }, [pathname]);

  const analyzeContext = useMemo(() => parseAnalyzeContext(pathname, search), [pathname, search]);
  const analyzeKey = useMemo(() => JSON.stringify(analyzeContext?.payload ?? {}), [analyzeContext]);

  const runProactiveAnalyze = async (force = false): Promise<void> => {
    if (!analyzeContext) {
      return;
    }

    if (!force && lastAnalyzedKey === analyzeKey) {
      return;
    }

    setAnalyzeLoading(true);
    setAnalyzeError(null);

    try {
      const response = await fetch('/api/rashi/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(analyzeContext.payload),
      });

      const payload = (await response.json().catch(() => ({}))) as AnalyzeResponsePayload;
      if (!response.ok) {
        throw new Error(payload.message ?? 'Unable to generate proactive underwriting insights.');
      }

      const nextAlerts = uniqueItems(payload.alerts);
      const nextBundles = uniqueItems(payload.bundles);

      setAlerts(nextAlerts);
      setBundles(nextBundles);
      setTargetLabel(payload.prospect?.displayName ?? analyzeContext.label);
      setLastAnalyzedKey(analyzeKey);
    } catch (error) {
      setAnalyzeError(error instanceof Error ? error.message : 'Unable to generate proactive underwriting insights.');
    } finally {
      setAnalyzeLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !analyzeContext) {
      return;
    }

    void runProactiveAnalyze();
  }, [open, analyzeKey]);

  const submitMessage = async (): Promise<void> => {
    const message = input.trim();
    if (!message || sending) {
      return;
    }

    const userEntry: WidgetMessage = { role: 'user', content: message };
    setMessages((current) => [...current, userEntry]);
    setInput('');
    setSending(true);

    try {
      const response = await fetch('/api/rashi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          sessionId,
          pagePath: pathname,
          contextId: null,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to chat with Rashi.');
      }

      const payload = (await response.json()) as { answer?: string; sessionId?: string };
      if (payload.sessionId && payload.sessionId !== sessionId) {
        setSessionId(payload.sessionId);
      }

      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: payload.answer ?? 'I could not generate a response for that request.',
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: 'I could not reach the knowledge service right now. Please try again in a moment.',
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="fixed bottom-4 right-4 z-[80] rounded-full bg-[#0b2545] px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-[#133a6b]"
      >
        {open ? 'Hide Rashi' : 'Rashi'}
      </button>

      {open ? (
        <section className="fixed bottom-16 right-4 z-[80] flex h-[28rem] w-[22rem] flex-col overflow-hidden rounded-2xl border border-[#d4d6dc] bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-[#eceef3] bg-[#f5f7fb] px-4 py-3">
            <div>
              <p className="text-sm font-bold text-[#081a30]">Rashi Assistant</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setSessionId(generateSessionId());
                setAnalyzeError(null);
                setLastAnalyzedKey('');
                setOpen(false);
              }}
              className="text-[11px] font-semibold text-[#5c667a] transition hover:text-[#081a30]"
            >
              Clear
            </button>
          </header>

          {analyzeContext ? (
            <div className="border-b border-[#eceef3] bg-[#f7f9fd] px-3 py-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[11px] font-semibold text-[#0b2545]">Proactive Insights: {targetLabel || analyzeContext.label}</p>
                <button
                  type="button"
                  onClick={() => {
                    void runProactiveAnalyze(true);
                  }}
                  disabled={analyzeLoading}
                  className="text-[10px] font-semibold text-[#0f62af] disabled:text-[#92a4bc]"
                >
                  {analyzeLoading ? 'Scanning...' : 'Refresh'}
                </button>
              </div>

              <div className="mb-1 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInsightTab('alerts')}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    insightTab === 'alerts'
                      ? 'border-rose-300 bg-rose-50 text-rose-700'
                      : 'border-[#cfd6e4] bg-white text-[#334155]'
                  }`}
                >
                  Alerts {alerts.length > 0 ? `(${alerts.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => setInsightTab('bundles')}
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                    insightTab === 'bundles'
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[#cfd6e4] bg-white text-[#334155]'
                  }`}
                >
                  Bundles {bundles.length > 0 ? `(${bundles.length})` : ''}
                </button>
              </div>

              {analyzeError ? <p className="text-[10px] text-rose-700">{analyzeError}</p> : null}

              {!analyzeError ? (
                <ul className="max-h-16 list-disc space-y-0.5 overflow-y-auto pl-4 text-[10px] text-[#24374b]">
                  {(insightTab === 'alerts' ? alerts : bundles).length > 0 ? (
                    (insightTab === 'alerts' ? alerts : bundles).slice(0, 4).map((item) => <li key={item}><InlineMd>{item}</InlineMd></li>)
                  ) : (
                    <li>{analyzeLoading ? 'Analyzing this prospect...' : 'No proactive insights yet for this context.'}</li>
                  )}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex-1 space-y-2 overflow-y-auto bg-[#fbfcff] p-3 text-xs leading-relaxed text-[#203246]">
            {visibleMessages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`max-w-[88%] rounded-xl p-2.5 ${
                  message.role === 'user' ? 'ml-auto bg-[#e7f0ff] text-[#153d74]' : 'bg-white ring-1 ring-[#e5e9f1]'
                }`}
              >
                {message.role === 'assistant' ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      p: ({ children }) => <p className="my-1">{children}</p>,
                      ul: ({ children }) => <ul className="list-disc space-y-1 pl-4">{children}</ul>,
                      li: ({ children }) => <li className="my-1">{children}</li>,
                      strong: ({ children }) => <strong className="rounded bg-blue-100 px-0.5 font-bold text-[#0f62af]">{children}</strong>,
                    }}
                  >
                    {message.content}
                  </ReactMarkdown>
                ) : (
                  message.content
                )}
              </div>
            ))}
          </div>

          <footer className="border-t border-[#eceef3] bg-white p-2.5">
            <div className="relative flex items-center">
              <input
                type="text"
                placeholder="Ask appetite, exclusions..."
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void submitMessage();
                  }
                }}
                className="w-full rounded-lg border border-[#d6dbe5] bg-[#f7f9fd] px-3 py-2 pr-12 text-xs text-[#081a30] outline-none transition focus:border-[#0f62af] focus:bg-white"
              />
              <button
                type="button"
                onClick={() => {
                  void submitMessage();
                }}
                disabled={sending}
                className="absolute right-2 text-xs font-bold text-[#0f62af] transition hover:text-[#0b4b87] disabled:cursor-not-allowed disabled:text-[#92a4bc]"
              >
                {sending ? '...' : 'Ask'}
              </button>
            </div>
          </footer>
        </section>
      ) : null}
    </>
  );
}
