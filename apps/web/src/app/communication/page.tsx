'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { ExternalLink, Inbox as InboxIcon, Search, Send } from 'lucide-react';
import SectionLayout from '../../components/crm/SectionLayout';

interface Conversation {
  client_id: string;
  name: string;
  email: string | null;
  lead_id: string | null;
  last_subject: string | null;
  last_snippet: string;
  last_direction: string;
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
}

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

export default function CommunicationCenterPage(): JSX.Element {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Composer
  const [subjectDraft, setSubjectDraft] = useState('');
  const [bodyDraft, setBodyDraft] = useState('');
  const [isSending, setIsSending] = useState(false);

  const loadConversations = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch('/api/communication/inbox', { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to load the inbox.');
        return;
      }
      const payload = (await res.json()) as { conversations: Conversation[] };
      setConversations(payload.conversations);
      setError(null);
    } catch {
      setError('Failed to load the inbox.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConversations();
    const timer = setInterval(() => void loadConversations(), 30000);
    return () => clearInterval(timer);
  }, [loadConversations]);

  const selected = useMemo(
    () => conversations.find((conversation) => conversation.client_id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const openConversation = useCallback(
    async (conversation: Conversation): Promise<void> => {
      setSelectedId(conversation.client_id);
      setIsLoadingThread(true);
      try {
        const res = await fetch(`/api/communication-log?client_id=${encodeURIComponent(conversation.client_id)}`, { cache: 'no-store' });
        const rows = res.ok ? ((await res.json()) as Message[]) : [];
        setMessages([...rows].sort((a, b) => (a.sent_at ?? '').localeCompare(b.sent_at ?? '')));
        if (conversation.unread > 0) {
          void fetch('/api/communication-log/mark-read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_id: conversation.client_id }),
          }).then(() => void loadConversations());
        }
      } catch {
        setMessages([]);
      } finally {
        setIsLoadingThread(false);
      }
    },
    [loadConversations],
  );

  const sendMessage = async (): Promise<void> => {
    if (!selected || !bodyDraft.trim()) return;
    if (!selected.email) {
      setError('This contact has no email address on file.');
      return;
    }
    setIsSending(true);
    setError(null);
    try {
      const res = await fetch('/api/communication-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: selected.client_id,
          channel: 'email',
          direction: 'outbound',
          subject: subjectDraft.trim() || 'Message from Shield Assurance',
          body: bodyDraft.trim(),
          automation_type: 'manual',
          to: selected.email,
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string };
        setError(payload.message ?? 'Failed to send.');
        return;
      }
      setBodyDraft('');
      setSubjectDraft('');
      await openConversation(selected);
      await loadConversations();
    } catch {
      setError('Failed to send.');
    } finally {
      setIsSending(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (conversation) =>
        conversation.name.toLowerCase().includes(needle) ||
        (conversation.email ?? '').toLowerCase().includes(needle) ||
        (conversation.last_subject ?? '').toLowerCase().includes(needle),
    );
  }, [conversations, search]);

  const totalUnread = conversations.reduce((sum, conversation) => sum + conversation.unread, 0);

  return (
    <SectionLayout title="Communication Center">
      <div className="flex h-[calc(100vh-10rem)] min-h-[480px] overflow-hidden rounded border border-cui-border/60 bg-white shadow-card">
        {/* Conversation list */}
        <div className="flex w-80 shrink-0 flex-col border-r border-cui-border/60">
          <div className="border-b border-cui-border/60 p-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-cui-muted" />
              <input
                type="text"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={`Search ${conversations.length} conversations…`}
                className="w-full rounded border border-cui-border py-1.5 pl-8 pr-2.5 text-sm focus:border-cui-primary focus:outline-none"
              />
            </div>
            {totalUnread > 0 ? (
              <p className="mt-1.5 text-xs font-semibold text-cui-primary">{totalUnread} unread {totalUnread === 1 ? 'message' : 'messages'}</p>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? <p className="p-4 text-sm text-cui-muted">Loading…</p> : null}
            {!isLoading && filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-2 p-6 text-center text-sm text-cui-muted">
                <InboxIcon className="h-6 w-6" />
                {conversations.length === 0
                  ? 'No conversations yet. Send a message from any lead profile and the thread will appear here.'
                  : 'No conversations match your search.'}
              </div>
            ) : null}
            {filtered.map((conversation) => (
              <button
                key={conversation.client_id}
                type="button"
                onClick={() => void openConversation(conversation)}
                className={`block w-full border-b border-cui-light px-3 py-2.5 text-left transition hover:bg-cui-light/60 ${
                  selectedId === conversation.client_id ? 'bg-cui-primary/5' : ''
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className={`truncate text-sm ${conversation.unread > 0 ? 'font-bold text-cui-text' : 'font-semibold text-cui-text'}`}>
                    {conversation.name}
                  </p>
                  <span className="shrink-0 text-[11px] text-cui-muted">{relativeTime(conversation.last_at)}</span>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className={`truncate text-xs ${conversation.unread > 0 ? 'font-semibold text-cui-text' : 'text-cui-muted'}`}>
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
        </div>

        {/* Thread */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-cui-muted">
              <InboxIcon className="h-8 w-8" />
              <p className="text-sm">Pick a conversation to read and reply.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cui-border/60 bg-cui-light px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-cui-text">{selected.name}</p>
                  <p className="truncate text-xs text-cui-muted">{selected.email ?? 'No email on file'}</p>
                </div>
                {selected.lead_id ? (
                  <Link
                    href={`/leads?lead=${selected.lead_id}` as Route}
                    className="inline-flex items-center gap-1 rounded border border-cui-border bg-white px-2.5 py-1 text-xs font-semibold text-cui-primary transition hover:bg-cui-primary/5"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Open lead profile
                  </Link>
                ) : null}
              </div>

              {error ? (
                <div className="mx-4 mt-2 rounded border border-cui-danger/40 bg-cui-danger/10 px-3 py-1.5 text-sm text-cui-danger">{error}</div>
              ) : null}

              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
                {isLoadingThread ? <p className="text-sm text-cui-muted">Loading conversation…</p> : null}
                {!isLoadingThread && messages.length === 0 ? (
                  <p className="text-sm text-cui-muted">No messages logged with this contact yet.</p>
                ) : null}
                {messages.map((message) => {
                  const outbound = (message.direction ?? 'outbound') === 'outbound';
                  return (
                    <div
                      key={message.id}
                      className={`max-w-[80%] rounded border p-2.5 text-sm ${
                        outbound ? 'ml-auto border-cui-primary/30 bg-cui-primary/5' : 'border-cui-border/60 bg-cui-light/60'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-cui-muted">
                        <span className="font-bold uppercase">
                          {message.channel ?? 'email'} · {outbound ? 'Sent' : 'Received'}
                          {message.automation_type === 'outreach_sequence' ? ' · sequence' : ''}
                        </span>
                        <span>{prettyDateTime(message.sent_at)}</span>
                      </div>
                      {message.subject ? <p className="font-semibold text-cui-text">{message.subject}</p> : null}
                      <p className="whitespace-pre-wrap text-cui-text">{message.body || '--'}</p>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-t border-cui-border/60 p-3">
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
                    placeholder={selected.email ? `Email ${selected.name}…` : 'No email on file for this contact.'}
                    disabled={!selected.email}
                    className="min-h-[4.5rem] flex-1 rounded border border-cui-border px-2.5 py-1.5 text-sm focus:border-cui-primary focus:outline-none disabled:bg-cui-light"
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={isSending || !bodyDraft.trim() || !selected.email}
                    className="inline-flex items-center gap-1.5 rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white transition hover:bg-cui-primary/90 disabled:opacity-60"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {isSending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </SectionLayout>
  );
}
