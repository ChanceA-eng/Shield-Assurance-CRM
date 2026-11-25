'use client';

import React, { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const ToolContext = createContext<{ open: string | null; setOpen: (id: string | null) => void } | null>(null);

export function ConversationTools({ children }: { children: ReactNode }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null);
  return <ToolContext.Provider value={{ open, setOpen }}>{children}</ToolContext.Provider>;
}

export default function ConversationTool({ label, title = label, children, large = false, disabled = false, selected = false, onOpen, action = false }: {
  label: string; title?: string; children: ReactNode | ((close: () => void) => ReactNode); large?: boolean; disabled?: boolean;
  selected?: boolean; onOpen?: () => void;
  action?: boolean;
}): JSX.Element {
  const id = useId();
  const context = useContext(ToolContext);
  const [localOpen, setLocalOpen] = useState<string | null>(null);
  const open = (context?.open ?? localOpen) === id;
  const setOpen = context?.setOpen ?? setLocalOpen;
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    const panel = dialog.current;
    if (!panel) return;
    if (!open) { if (panel.open) panel.close(); return; }
    const position = (): void => {
      if (large || !trigger.current) return;
      const anchor = trigger.current.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      const height = Math.max(80, anchor.top - 20);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
      panel.style.top = `${Math.max(12, anchor.top - panel.getBoundingClientRect().height - 8)}px`;
    };
    panel.showModal();
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener('resize', position);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', position);
      if (panel.open) panel.close();
    };
  }, [open, mounted, large]);
  return <>
    <button ref={trigger} type="button" aria-label={title} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={id} disabled={disabled} data-conversation-tool={label}
      onClick={() => { setOpen(open ? null : id); if (!open) onOpen?.(); }}
      className={`inline-flex min-w-0 items-center justify-center rounded font-semibold disabled:opacity-50 ${action ? 'h-9 border px-3 text-sm' : 'h-9 min-w-8 px-1 text-[11px] sm:h-8 sm:px-2 sm:text-xs'} ${selected || open
        ? 'border-cui-primary bg-cui-primary/10 text-cui-primary' : 'border-cui-border text-cui-text hover:bg-cui-light'}`}>
      <span className="truncate">{label}{selected ? ' ·' : ''}</span>
    </button>
    {mounted ? createPortal(<dialog ref={dialog} id={id} aria-label={title}
      onCancel={() => setOpen(null)}
      onClick={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.target === event.currentTarget && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) setOpen(null);
      }}
      className={`fixed z-[120] overflow-y-auto overscroll-contain rounded-lg border border-cui-border bg-white p-0 text-cui-text shadow-2xl backdrop:bg-black/20 ${large
        ? 'm-auto max-h-[80dvh] w-[min(42rem,calc(100vw-24px))]' : 'm-0 max-w-none'}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cui-border bg-white px-3 py-2">
        <h4 className="text-sm font-semibold">{title}</h4>
        <button type="button" aria-label={`Close ${title}`} onClick={() => setOpen(null)}
          className="flex h-9 w-9 items-center justify-center rounded hover:bg-cui-light"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3 p-3">{typeof children === 'function' ? children(() => setOpen(null)) : children}</div>
    </dialog>, document.body) : null}
  </>;
}
