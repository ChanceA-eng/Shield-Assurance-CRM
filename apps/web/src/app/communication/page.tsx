'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { AlertTriangle, ExternalLink, Inbox as InboxIcon, MessageSquareOff, RefreshCw, Search, Send } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';
import { MESSAGES_READ_EVENT } from '../../context/NotificationContext';
import { unreadInboundIds } from '../../lib/conversations';
import { markMessagesRead, messageStatusLabel, readErrorMessage } from '../../lib/message-read';

type ConversationKind = 'client' | 'lead' | 'unmatched';

interface Conversation {
  key: string;
  kind: ConversationKind;
  client_id: string | null;
  lead_id: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  href: string;
  can_email: boolean;
  last_subject: string | null;
  last_snippet: string;
  last_direction: string;
  last_channel: string | null;
  last_at: string | null;
  unread: number;
  total: number;
}

interface Message {
  id: string;
  channel: string | null;
  direction: string | null;
  subject: string | null;
  body: string | null;
  automation_type: string | null;
  sent_at: string | null;
  read_at: string | null;
  metadata: Record<string, unknown> | null;
}

const KIND_BADGE: Record<ConversationKind, { label: string; className: string }> = {
  client: { label: 'Account', className: 'bg-cui-primary/10 text-cui-primary' },
  lead: { label: 'Lead', className: 'bg-cui-success/15 text-[#2a7a48]' },
  unmatched: { label: 'Unmatched', className: 'bg-cui-warning/20 text-[#7a5a00]' },
};

function prettyDateTime(value: string | null | undefined): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function relativeTime(value: string | null): string {
  if (!value) return '';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '';
  const minutes = Math.floor((Date.now() - time) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function placeholderConversation(key: string): Conversation {
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  const safeKind: ConversationKind = kind === 'client' || kind === 'lead' ? kind : 'unmatched';
  return {
    key,
    kind: safeKind,
    client_id: safeKind === 'client' ? id : null,
    lead_id: safeKind === 'lead' ? id : null,
    name: safeKind === 'unmatched' ? id : 'Conversation',
    email: safeKind === 'unmatched' && id.includes('@') ? id : null,
    phone: null,
    address: safeKind === 'unmatched' ? id : null,
    href: `/communication?conversation=${encodeURIComponent(key)}`,
    can_email: safeKind !== 'unmatched' || id.includes('@'),
    last_subject: null,
    last_snippet: '',
    last_direction: 'outbound',
    last_channel: null,
    last_at: null,
    unread: 0,
    total: 0,
  };
}

export default function CommunicationCenterPage(): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [listPage, setListPage] = useState(0);
  const [listTotal, setListTotal] = useState(0);
  const [threadNext, setThreadNext] = useState<number | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadKey, setThreadKey] = useState<string | null>(null);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const threadRequest = useRef(0);
  const listRequest = useRef(0);
  const selectedKeyRef = useRef<string | null>(null);

  const [subjectDraft, setSubjectDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const loadConversations = useCallback(async (): Promise<void> => {
    const requestId = ++listRequest.current;
    try {
      const res = await fetch(`/api/communication/inbox?${new URLSearchParams({ page: String(listPage), q: search })}`, { cache: 'no-store' });
      if (!res.ok) {
        // Keep the last good list on screen; only report the failure.
        const message = await readErrorMessage(res, 'The inbox could not be refreshed');
        if (requestId === listRequest.current) setListError(message);
        return;
      }
      const payload = (await res.json()) as { conversations?: Conversation[]; total?: number };
      if (requestId !== listRequest.current) return;
      setConversations(payload.conversations ?? []);
      setListTotal(payload.total ?? payload.conversations?.length ?? 0);
      setListError(null);
    } catch {
      if (requestId === listRequest.current) setListError('The inbox could not be refreshed. Check your connection.');
    } finally {
      if (requestId === listRequest.current) setHasLoadedList(true);
    }
  }, [listPage, search]);

  /** Loads a thread; messages are marked read only after they were loaded and shown. */
  const loadThread = useCallback(async (key: string, options: { silent?: boolean; offset?: number } = {}): Promise<void> => {
    const requestId = ++threadRequest.current;
    if (!options.silent) setIsLoadingThread(true);
    try {
      const res = await fetch(`/api/communication-log?conversation_key=${encodeURIComponent(key)}&offset=${options.offset ?? 0}`, { cache: 'no-store' });
      if (requestId !== threadRequest.current) return;
      if (!res.ok) {
        setThreadError(await readErrorMessage(res, 'This conversation could not be loaded'));
        return;
      }
      const rows = (await res.json()) as Message[];
      if (requestId !== threadRequest.current) return;
      const next = res.headers.get('X-Next-Offset');
      if (!options.silent) setThreadNext(next ? Number(next) : null);
      setMessages((current) => [...new Map([...(options.offset || options.silent ? current : []), ...rows].map((row) => [row.id, row])).values()]
        .sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '')));
      setThreadKey(key);
      setThreadError(null);

      const unread = unreadInboundIds(rows);
      if (unread.length === 0 || document.visibilityState !== 'visible') return;
      const marked = await markMessagesRead(unread);
      if (requestId !== threadRequest.current) return;
      if (!marked.ok) {
        setReadError(`${marked.message} These messages still show as unread.`);
        return;
      }
      setReadError(null);
      const readAt = new Date().toISOString();
      setMessages((current) => current.map((message) => (unread.includes(message.id) ? { ...message, read_at: readAt } : message)));
      window.dispatchEvent(new Event(MESSAGES_READ_EVENT));
      void loadConversations();
    } catch {
      if (requestId === threadRequest.current) setThreadError('This conversation could not be loaded. Check your connection.');
    } finally {
      if (requestId === threadRequest.current) setIsLoadingThread(false);
    }
  }, [loadConversations]);

  useEffect(() => { void loadConversations(); }, [loadConversations]);

  const openConversation = useCallback((key: string): void => {
    selectedKeyRef.current = key;
    setSelectedKey(key);
    setThreadError(null);
    setReadError(null);
    setSendError(null);
    setNotice(null);
    if (threadKey !== key) setMessages([]);
    void loadThread(key);
    const url = new URL(window.location.href);
    url.searchParams.set('conversation', key);
    window.history.replaceState(null, '', url.toString());
  }, [loadThread, threadKey]);

  useEffect(() => {
    void loadConversations();
    const requested = new URLSearchParams(window.location.search).get('conversation');
    if (requested) {
      selectedKeyRef.current = requested;
      setSelectedKey(requested);
      void loadThread(requested);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadConversations();
      if (selectedKeyRef.current) void loadThread(selectedKeyRef.current, { silent: true });
    }, 30000);
    return () => clearInterval(timer);
  }, [loadConversations, loadThread]);

  const selected = useMemo(
    () => (selectedKey ? conversations.find((conversation) => conversation.key === selectedKey) ?? placeholderConversation(selectedKey) : null),
    [conversations, selectedKey],
  );

  const sendMessage = async (): Promise<void> => {
    if (!selected || !bodyDraft.trim()) return;
    if (!selected.can_email) {
      setSendError('This conversation has no email address. Text replies cannot be sent from the CRM.');
      return;
    }
    setIsSending(true);
    setSendError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/communication-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_key: selected.key,
          channel: 'email',
          direction: 'outbound',
          subject: subjectDraft.trim() || 'Message from Shield Assurance',
          body: bodyDraft.trim(),
          automation_type: 'manual',
        }),
      });
      if (!res.ok) {
        setSendError(await readErrorMessage(res, 'The email was not sent'));
        return;
      }
      setBodyDraft('');
      setSubjectDraft('');
      setNotice('Email accepted by the provider for delivery.');
      await loadThread(selected.key, { silent: true });
      await loadConversations();
    } catch {
      setSendError('The email could not be sent. Check your connection and try again.');
    } finally {
      setIsSending(false);
    }
  };

  const filtered = useMemo(() => {
    return conversations;
  }, [conversations, search]);

  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);
  const showThread = selected && threadKey === selected.key;

  return (
    <SectionLayout title="Communication Center">
      <div className="flex h-[calc(100vh-10rem)] min-h-[480px] overflow-hidden rounded border border-cui-border/60 bg-white shadow-card">
        <div className={`flex w-full shrink-0 flex-col border-r border-cui-border/60 md:w-80 ${selected ? 'hidden md:flex' : ''}`}>
          <div className="border-b border-cui-border/60 bg-cui-light p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-cui-muted" />
              <input
                type="text"
                value={search}
                onChange={(event) => { setSearch(event.target.value); setListPage(0); }}
                aria-label="Search all conversations"
                placeholder={`Search ${listTotal} conversations…`}
                className="w-full rounded border border-cui-border bg-white py-1.5 pl-8 pr-2.5 text-sm focus:border-cui-primary focus:outline-none"
              />
            </div>
            {totalUnread > 0 ? (
              <p className="mt-1.5 text-xs font-semibold text-cui-primary">{totalUnread} unread {totalUnread === 1 ? 'message' : 'messages'} on this page</p>
            ) : null}
            {listError ? (
              <div role="alert" className="mt-2 flex items-start gap-1.5 rounded border border-cui-danger/40 bg-cui-danger/10 px-2 py-1.5 text-xs text-cui-danger">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">{listError}</span>
                <button type="button" className="font-semibold underline" onClick={() => void loadConversations()}>Retry</button>
              </div>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {!hasLoadedList ? <p className="p-4 text-sm text-cui-muted">Loading…</p> : null}
            {hasLoadedList && filtered.length === 0 && !listError ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-cui-muted">
                <InboxIcon className="h-6 w-6" />
                {conversations.length === 0
                  ? 'No conversations yet. Send a message from any lead or account and the thread will appear here.'
                  : 'No conversations match your search.'}
              </div>
            ) : null}
            {filtered.map((conversation) => (
              <button
                key={conversation.key}
                type="button"
                data-conversation-key={conversation.key}
                onClick={() => openConversation(conversation.key)}
                className={`block w-full border-b border-cui-light px-3 py-2.5 text-left transition hover:bg-cui-light/60 ${
                  selectedKey === conversation.key ? 'bg-cui-primary/5' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${conversation.unread > 0 ? 'font-bold text-cui-text' : 'font-semibold text-cui-text'}`}>
                    {conversation.name}
                  </p>
                  <span className="shrink-0 text-[11px] text-cui-muted">{relativeTime(conversation.last_at)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className={`shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${KIND_BADGE[conversation.kind].className}`}>
                    {KIND_BADGE[conversation.kind].label}
                  </span>
                  <p className={`min-w-0 flex-1 truncate text-xs ${conversation.unread > 0 ? 'font-semibold text-cui-text' : 'text-cui-muted'}`}>
                    {conversation.last_direction === 'inbound' ? '' : 'You: '}
                    {conversation.last_snippet || conversation.last_subject || '--'}
                  </p>
                  {conversation.unread > 0 ? (
                    <span className="shrink-0 rounded-full bg-cui-primary px-1.5 py-0.5 text-[10px] font-bold text-white">
                      {conversation.unread}
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-cui-border p-3 text-xs">
            <button disabled={listPage === 0} onClick={() => setListPage((value) => value - 1)} className="text-cui-primary disabled:opacity-40">Previous conversations</button>
            <span>{listPage + 1} / {Math.max(1, Math.ceil(listTotal / 25))}</span>
            <button disabled={(listPage + 1) * 25 >= listTotal} onClick={() => setListPage((value) => value + 1)} className="text-cui-primary disabled:opacity-40">Next conversations</button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-cui-muted">
              <InboxIcon className="h-8 w-8" />
              <p className="text-sm">Pick a conversation to read and reply.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cui-border/60 bg-cui-light px-4 py-2.5">
                <button className="text-xs text-cui-primary md:hidden" onClick={() => { selectedKeyRef.current = null; threadRequest.current++; setSelectedKey(null); }}>Back to inbox</button>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-bold text-cui-text">{selected.name}</p>
                    <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${KIND_BADGE[selected.kind].className}`}>{KIND_BADGE[selected.kind].label}</span>
                  </div>
                  <p className="truncate text-xs text-cui-muted">{[selected.email, selected.phone].filter(Boolean).join(' · ') || 'No contact details on file'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {selected.kind === 'client' && selected.client_id ? (
                    <Link href={`/clients/${selected.client_id}?tab=communication` as Route}
                      className="inline-flex items-center gap-1 rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/5">
                      <ExternalLink className="h-3 w-3" /> Open account
                    </Link>
                  ) : null}
                  {selected.lead_id ? (
                    <Link href={`/leads?lead=${selected.lead_id}&tab=conversation` as Route}
                      className="inline-flex items-center gap-1 rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/5">
                      <ExternalLink className="h-3 w-3" /> Open lead
                    </Link>
                  ) : null}
                </div>
              </div>

              {threadError ? (
                <div role="alert" className="mx-4 mt-2 flex items-center gap-2 rounded border border-cui-danger/40 bg-cui-danger/10 px-3 py-1.5 text-sm text-cui-danger">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{threadError}</span>
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-semibold underline" onClick={() => void loadThread(selected.key)}>
                    <RefreshCw className="h-3 w-3" /> Retry
                  </button>
                </div>
              ) : null}
              {readError ? (
                <div role="alert" className="mx-4 mt-2 rounded border border-cui-warning/50 bg-cui-warning/15 px-3 py-1.5 text-sm text-[#7a5a00]">{readError}</div>
              ) : null}

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
                {threadNext !== null ? <button disabled={isLoadingThread} className="text-sm font-semibold text-cui-primary" onClick={() => void loadThread(selected.key, { offset: threadNext })}>Load older messages</button> : null}
                {isLoadingThread && !showThread ? <p className="text-sm text-cui-muted">Loading conversation…</p> : null}
                {showThread && messages.length === 0 ? (
                  <p className="text-sm text-cui-muted">No messages logged with this contact yet.</p>
                ) : null}
                {showThread ? messages.map((message) => {
                  const outbound = (message.direction ?? 'outbound') === 'outbound';
                  return (
                    <div
                      key={message.id}
                      className={`max-w-[80%] rounded border p-2.5 text-sm ${
                        outbound ? 'ml-auto border-cui-primary/30 bg-cui-primary/5' : 'border-cui-border/60 bg-cui-light/60'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-cui-muted">
                        <span className="font-bold uppercase">{message.channel ?? 'email'} · {messageStatusLabel(message)}</span>
                        <span>{prettyDateTime(message.sent_at)}</span>
                      </div>
                      {message.subject ? <p className="font-semibold text-cui-text">{message.subject}</p> : null}
                      <p className="whitespace-pre-wrap text-cui-text">{message.body || '--'}</p>
                    </div>
                  );
                }) : null}
              </div>

              <div className="space-y-2 border-t border-cui-border/60 p-3">
                {sendError ? <div role="alert" className="rounded border border-cui-danger/40 bg-cui-danger/10 px-3 py-1.5 text-sm text-cui-danger">{sendError}</div> : null}
                {notice ? <div role="status" className="rounded border border-cui-success/40 bg-cui-success/10 px-3 py-1.5 text-sm text-[#2a7a48]">{notice}</div> : null}
                {selected.can_email ? (
                  <>
                    <input
                      type="text"
                      value={subjectDraft}
                      onChange={(event) => setSubjectDraft(event.target.value)}
                      placeholder="Subject"
                      className="w-full rounded border border-cui-border px-2.5 py-1.5 text-sm focus:border-cui-primary focus:outline-none"
                    />
                    <div className="flex items-end gap-2">
                      <textarea
                        value={bodyDraft}
                        onChange={(event) => setBodyDraft(event.target.value)}
                        rows={3}
                        placeholder={`Email ${selected.name}…`}
                        className="min-h-[4.5rem] flex-1 rounded border border-cui-border px-2.5 py-1.5 text-sm focus:border-cui-primary focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void sendMessage()}
                        disabled={isSending || !bodyDraft.trim()}
                        className="inline-flex items-center gap-1.5 rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-cui-primary/90 disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {isSending ? 'Sending…' : 'Send email'}
                      </button>
                    </div>
                    <p className="text-[11px] text-cui-muted">Replies go out by email. Text messages cannot be sent from the CRM yet.</p>
                  </>
                ) : (
                  <div className="flex items-center gap-2 rounded border border-cui-border/60 bg-cui-light px-3 py-2 text-sm text-cui-muted">
                    <MessageSquareOff className="h-4 w-4 shrink-0" />
                    No email address for this conversation, and texts cannot be sent from the CRM. Reply from your phone or add an email to the record.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </SectionLayout>
  );
}
