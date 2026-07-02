'use client';

import React, { useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WidgetMessage {
  role: 'user' | 'assistant';
  content: string;
}

function generateSessionId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function RashiWidget(): JSX.Element {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<WidgetMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>(() => generateSessionId());

  const greeting = useMemo<WidgetMessage>(
    () => ({
      role: 'assistant',
      content: 'Ask an underwriting question to get a focused, line-by-line answer.',
    }),
    [],
  );

  const visibleMessages = messages.length > 0 ? messages : [greeting];

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
                setOpen(false);
              }}
              className="text-[11px] font-semibold text-[#5c667a] transition hover:text-[#081a30]"
            >
              Clear
            </button>
          </header>

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
                      strong: ({ children }) => <strong className="rounded bg-yellow-50 px-1 font-bold text-[#0b2545]">{children}</strong>,
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
