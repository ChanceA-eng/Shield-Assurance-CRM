'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export default function ConversationHistory({ children, revision, className = '' }: {
  children: ReactNode; revision: string; className?: string;
}): JSX.Element {
  const pane = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const anchor = useRef<{ id: string; offset: number } | null>(null);
  const previousLast = useRef<string | null>(null);
  const [newMessages, setNewMessages] = useState(false);
  const capture = (): void => {
    const node = pane.current;
    if (!node) return;
    atBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 48;
    const top = node.getBoundingClientRect().top;
    const visible = [...node.querySelectorAll<HTMLElement>('[data-history-id]')].find((item) => item.getBoundingClientRect().bottom > top);
    anchor.current = visible ? { id: visible.dataset.historyId ?? '', offset: visible.getBoundingClientRect().top - top } : null;
    if (atBottom.current) setNewMessages(false);
  };
  useLayoutEffect(() => {
    const node = pane.current;
    if (!node) return;
    const rows = [...node.querySelectorAll<HTMLElement>('[data-history-id]')];
    const last = rows.at(-1)?.dataset.historyId ?? null;
    if (atBottom.current) node.scrollTop = node.scrollHeight;
    else if (anchor.current) {
      const saved = anchor.current;
      const row = rows.find((item) => item.dataset.historyId === saved.id);
      if (row) node.scrollTop += row.getBoundingClientRect().top - node.getBoundingClientRect().top - saved.offset;
      if (last !== previousLast.current) setNewMessages(true);
    }
    previousLast.current = last;
    capture();
  }, [revision]);
  useLayoutEffect(() => {
    const node = pane.current;
    const content = node?.firstElementChild;
    if (!node || !content) return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current) node.scrollTop = node.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return <div className={`relative min-h-0 min-w-0 flex-1 ${className}`}>
    <div ref={pane} role="log" aria-label="Message history" aria-live="polite" onScroll={capture}
      data-conversation-history className="h-full overflow-y-auto overscroll-contain bg-[#edf1f6] p-3 md:p-4">
      <div className="mx-auto max-w-5xl space-y-3">{children}</div>
    </div>
    {newMessages ? <button type="button" className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-cui-primary px-3 py-2 text-xs font-semibold text-white shadow"
      onClick={() => { if (pane.current) pane.current.scrollTop = pane.current.scrollHeight; atBottom.current = true; setNewMessages(false); capture(); }}>
      Latest messages
    </button> : null}
  </div>;
}
