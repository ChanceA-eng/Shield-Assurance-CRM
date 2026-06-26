'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import SectionLayout from '../../../components/crm/SectionLayout';

interface Client {
  id: string;
  full_name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  source?: string | null;
  email_consent?: boolean | null;
  sms_consent?: boolean | null;
  preferred_channel?: string | null;
  created_at: string;
}

interface CommunicationItem {
  id: string;
  client_id?: string | null;
  channel: 'email' | 'sms' | 'in_app';
  direction?: 'outbound' | 'inbound' | null;
  subject?: string | null;
  body?: string | null;
  sent_at?: string | null;
  automation_type?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface ScheduledMessage {
  id: string;
  client_id: string;
  send_at: string;
  channel: 'email' | 'sms';
  subject?: string | null;
  body: string;
  automation_type: string;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

interface TaskItem {
  id: string;
  subject?: string | null;
  due_date?: string | null;
  status?: string | null;
  related_type?: string | null;
  related_id?: string | null;
}

interface EventItem {
  id: string;
  subject?: string | null;
  title?: string | null;
  event_date?: string | null;
  event_time?: string | null;
  all_day?: boolean | null;
  status?: string | null;
  related_type?: string | null;
  related_id?: string | null;
}

interface NotificationItem {
  id: string;
  type: string;
  message: string;
  read?: boolean | null;
  created_at?: string | null;
}

type TimelineItem =
  | (CommunicationItem & { kind: 'communication' })
  | (ScheduledMessage & { kind: 'scheduled' })
  | (TaskItem & { kind: 'task' })
  | (EventItem & { kind: 'event' })
  | (NotificationItem & { kind: 'notification' });

type ChannelFilter = 'all' | 'email' | 'sms' | 'in_app';

const emptyComposer: {
  channel: 'email' | 'sms';
  subject: string;
  body: string;
  sendAt: string;
  automationType: string;
} = {
  channel: 'email' as const,
  subject: '',
  body: '',
  sendAt: '',
  automationType: 'manual',
};

function safeDate(value?: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function timeOnly(value?: string | null): string {
  if (!value) return 'All day';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export default function ClientConversationPage(): JSX.Element {
  const params = useParams<{ clientId: string }>();
  const clientId = params.clientId;

  const [client, setClient] = useState<Client | null>(null);
  const [communications, setCommunications] = useState<CommunicationItem[]>([]);
  const [scheduledMessages, setScheduledMessages] = useState<ScheduledMessage[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');
  const [composer, setComposer] = useState(emptyComposer);
  const [savingMessage, setSavingMessage] = useState(false);
  const [editingMessage, setEditingMessage] = useState<ScheduledMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = async (): Promise<void> => {
    setLoading(true);
    setError(null);

    const [clientData, communicationData, scheduledData, taskData, eventData, notificationData] = await Promise.all([
      safeJson<Client>(`/api/clients/${clientId}`),
      safeJson<CommunicationItem[]>(`/api/communication-log?client_id=${clientId}`),
      safeJson<ScheduledMessage[]>(`/api/scheduled-messages?client_id=${clientId}`),
      safeJson<TaskItem[]>(`/api/tasks?related_type=client&related_id=${clientId}`),
      safeJson<EventItem[]>(`/api/events?related_type=client&related_id=${clientId}`),
      safeJson<NotificationItem[]>(`/api/notifications?client_id=${clientId}`),
    ]);

    setClient(clientData);
    setCommunications(communicationData ?? []);
    setScheduledMessages(scheduledData ?? []);
    setTasks(taskData ?? []);
    setEvents(eventData ?? []);
    setNotifications(notificationData ?? []);
    setLoading(false);
  };

  useEffect(() => {
    if (clientId) {
      void loadData();
    }
  }, [clientId]);

  const timeline = useMemo<TimelineItem[]>(() => {
    const rows: TimelineItem[] = [
      ...communications.map((item) => ({ ...item, kind: 'communication' as const })),
      ...scheduledMessages.map((item) => ({ ...item, kind: 'scheduled' as const })),
      ...tasks.map((item) => ({ ...item, kind: 'task' as const })),
      ...events.map((item) => ({ ...item, kind: 'event' as const })),
      ...notifications.map((item) => ({ ...item, kind: 'notification' as const })),
    ];

    return rows.sort((left, right) => {
      const leftDate = new Date(
        (left.kind === 'communication' ? left.sent_at : left.kind === 'scheduled' ? left.send_at : left.kind === 'task' ? left.due_date : left.kind === 'event' ? left.event_date : left.created_at) ?? 0,
      ).getTime();
      const rightDate = new Date(
        (right.kind === 'communication' ? right.sent_at : right.kind === 'scheduled' ? right.send_at : right.kind === 'task' ? right.due_date : right.kind === 'event' ? right.event_date : right.created_at) ?? 0,
      ).getTime();
      return leftDate - rightDate;
    });
  }, [communications, scheduledMessages, tasks, events, notifications]);

  const sendManualMessage = async (): Promise<void> => {
    if (!client) return;
    if (composer.channel === 'email' && !client.email_consent) {
      setError('This client has not consented to email messages.');
      return;
    }
    if (composer.channel === 'sms' && !client.sms_consent) {
      setError('This client has not consented to SMS messages.');
      return;
    }

    setSavingMessage(true);
    setError(null);

    const futureSend = composer.sendAt ? new Date(composer.sendAt).getTime() > Date.now() : false;
    const endpoint = futureSend ? '/api/scheduled-messages' : '/api/communication-log';
    const payload = futureSend
      ? {
          client_id: client.id,
          send_at: new Date(composer.sendAt).toISOString(),
          channel: composer.channel,
          subject: composer.subject || null,
          body: composer.body,
          automation_type: composer.automationType || 'manual',
          status: 'pending',
        }
      : {
          client_id: client.id,
          channel: composer.channel,
          direction: 'outbound' as const,
          subject: composer.subject || null,
          body: composer.body,
          automation_type: composer.automationType || 'manual',
        };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Message could not be saved.' }))) as { message?: string };
      setError(payloadData.message ?? 'Message could not be saved.');
      setSavingMessage(false);
      return;
    }

    setComposer(emptyComposer);
    setSavingMessage(false);
    await loadData();
  };

  const saveScheduledMessage = async (): Promise<void> => {
    if (!editingMessage) return;

    const response = await fetch('/api/scheduled-messages', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: editingMessage.id,
        send_at: editingMessage.send_at,
        channel: editingMessage.channel,
        subject: editingMessage.subject ?? null,
        body: editingMessage.body,
        automation_type: editingMessage.automation_type,
        status: editingMessage.status,
      }),
    });

    if (!response.ok) {
      const payloadData = (await response.json().catch(() => ({ message: 'Could not update the scheduled message.' }))) as { message?: string };
      setError(payloadData.message ?? 'Could not update the scheduled message.');
      return;
    }

    setEditingMessage(null);
    await loadData();
  };

  const cancelScheduledMessage = async (scheduledMessageId: string): Promise<void> => {
    const response = await fetch('/api/scheduled-messages', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: scheduledMessageId }),
    });

    if (!response.ok) {
      setError('Could not cancel the scheduled message.');
      return;
    }

    await loadData();
  };

  return (
    <SectionLayout title="Client Conversation">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <Link href="/clients" className="text-sm font-semibold text-[#0176d3] hover:underline">
            Back to Clients
          </Link>
          <h2 className="mt-1 text-2xl font-bold text-[#080707]">{client?.full_name ?? 'Loading client...'}</h2>
          <p className="text-sm text-[#3e3e3c]">
            {client?.email || '--'} · {client?.phone || '--'}
          </p>
          <p className="text-xs text-[#60748a]">Source: {client?.source || '--'}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-[#3e3e3c]">
          <span className="rounded-full bg-[#e3f2ff] px-3 py-1 font-semibold text-[#0a4f8f]">
            Email {client?.email_consent ? 'Allowed' : 'Off'}
          </span>
          <span className="rounded-full bg-[#ecf8f1] px-3 py-1 font-semibold text-[#1f7a47]">
            SMS {client?.sms_consent ? 'Allowed' : 'Off'}
          </span>
          <span className="rounded-full bg-[#fff3de] px-3 py-1 font-semibold text-[#8a4d00]">
            Preferred {client?.preferred_channel || 'email'}
          </span>
        </div>
      </div>

      {error ? <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</div> : null}
      {loading ? <div className="text-sm text-[#6a6a6a]">Loading client conversation...</div> : null}

      {!loading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <section className="xl:col-span-2 rounded border border-[#dddbda] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#f3f2f1] px-4 py-3">
              <div>
                <h3 className="text-lg font-semibold text-[#080707]">Conversation Timeline</h3>
                <p className="text-xs text-[#6a6a6a]">Email, SMS, in-app alerts, tasks, events, and scheduled follow-ups.</p>
              </div>
              <select
                className="rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as ChannelFilter)}
              >
                <option value="all">All</option>
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="in_app">In-app</option>
              </select>
            </div>

            <div className="max-h-[72vh] space-y-3 overflow-y-auto p-4">
              {timeline.filter((item) => (item.kind === 'communication' ? channelFilter === 'all' || item.channel === channelFilter : true)).map((item) => {
                const timestamp =
                  item.kind === 'communication'
                    ? item.sent_at
                    : item.kind === 'scheduled'
                      ? item.send_at
                      : item.kind === 'task'
                        ? item.due_date
                        : item.kind === 'event'
                          ? item.event_date
                          : item.created_at;

                const label =
                  item.kind === 'communication'
                    ? item.channel === 'sms'
                      ? 'SMS'
                      : item.channel === 'email'
                        ? 'Email'
                        : 'In-app'
                    : item.kind === 'scheduled'
                      ? 'Scheduled'
                      : item.kind === 'task'
                        ? 'Task'
                        : item.kind === 'event'
                          ? 'Event'
                          : 'Notification';

                const headline =
                  item.kind === 'communication'
                    ? item.subject || item.automation_type || 'Message'
                    : item.kind === 'scheduled'
                      ? item.subject || item.automation_type || 'Scheduled follow-up'
                      : item.kind === 'task'
                        ? item.subject || 'Task'
                        : item.kind === 'event'
                          ? item.subject || item.title || 'Event'
                          : item.message;

                return (
                  <article key={`${item.kind}-${item.id}`} className="rounded-xl border border-[#e8eef7] bg-[#fbfdff] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#60748a]">
                          {label} {item.kind === 'communication' && item.direction === 'inbound' ? 'Inbound' : ''}
                        </p>
                        <h4 className="truncate text-sm font-semibold text-[#14324f]">{headline}</h4>
                        {item.kind === 'communication' ? <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.body}</p> : null}
                        {item.kind === 'scheduled' ? <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.body}</p> : null}
                        {item.kind === 'notification' ? <p className="mt-1 whitespace-pre-line text-sm text-[#425468]">{item.message}</p> : null}
                        {item.kind === 'task' ? <p className="mt-1 text-sm text-[#425468]">Due {safeDate(item.due_date)}</p> : null}
                        {item.kind === 'event' ? (
                          <p className="mt-1 text-sm text-[#425468]">
                            {safeDate(item.event_date)} · {item.all_day ? 'All day' : timeOnly(item.event_time)}
                          </p>
                        ) : null}
                      </div>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-[#0a4f8f] shadow-sm">
                        {safeDate(timestamp)}
                      </span>
                    </div>
                    {item.kind === 'scheduled' ? (
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                          onClick={() => setEditingMessage(item)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                          onClick={() => void cancelScheduledMessage(item.id)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>

          <aside className="space-y-4">
            <section className="rounded border border-[#dddbda] bg-white p-4 shadow-sm">
              <h3 className="text-lg font-semibold text-[#080707]">Send Message</h3>
              <p className="mb-3 text-xs text-[#6a6a6a]">Send immediately or schedule a follow-up. Consent is checked before outbound email or SMS.</p>
              <div className="space-y-2">
                <select
                  className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                  value={composer.channel}
                  onChange={(e) => setComposer((prev) => ({ ...prev, channel: e.target.value as 'email' | 'sms' }))}
                >
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                </select>
                <input
                  className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                  placeholder="Subject"
                  value={composer.subject}
                  onChange={(e) => setComposer((prev) => ({ ...prev, subject: e.target.value }))}
                />
                <textarea
                  className="min-h-32 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                  placeholder="Write your message"
                  value={composer.body}
                  onChange={(e) => setComposer((prev) => ({ ...prev, body: e.target.value }))}
                />
                <input
                  className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                  type="datetime-local"
                  value={composer.sendAt}
                  onChange={(e) => setComposer((prev) => ({ ...prev, sendAt: e.target.value }))}
                />
                <input
                  className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                  placeholder="Automation tag (manual, renewal, claim, etc.)"
                  value={composer.automationType}
                  onChange={(e) => setComposer((prev) => ({ ...prev, automationType: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={savingMessage}
                  onClick={() => void sendManualMessage()}
                  className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1] disabled:opacity-60"
                >
                  {savingMessage ? 'Saving...' : composer.sendAt ? 'Schedule Message' : 'Send Now'}
                </button>
              </div>
            </section>

            <section className="rounded border border-[#dddbda] bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-[#080707]">Scheduled Follow-ups</h3>
                <span className="text-xs text-[#6a6a6a]">{scheduledMessages.length} pending</span>
              </div>
              <div className="space-y-2">
                {scheduledMessages.length === 0 ? <p className="text-sm text-[#6a6a6a]">No pending follow-ups.</p> : null}
                {scheduledMessages.map((message) => (
                  <article key={message.id} className="rounded-lg border border-[#f3f2f1] bg-[#fbfbfb] p-3 text-sm">
                    <p className="font-semibold text-[#14324f]">{message.subject || message.automation_type}</p>
                    <p className="text-xs text-[#6a6a6a]">{message.channel.toUpperCase()} · {safeDate(message.send_at)} · {message.status}</p>
                    <p className="mt-1 line-clamp-2 text-[#425468]">{message.body}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        className="rounded bg-[#e7f2ff] px-3 py-1.5 text-xs font-semibold text-[#0a4f8f]"
                        onClick={() => setEditingMessage(message)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="rounded bg-[#ffe8e8] px-3 py-1.5 text-xs font-semibold text-[#9f2f2f]"
                        onClick={() => void cancelScheduledMessage(message.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </div>
      ) : null}

      {editingMessage ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded border border-[#dddbda] bg-white p-4 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-[#080707]">Edit Scheduled Message</h3>
            <div className="space-y-2">
              <input
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.subject ?? ''}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, subject: e.target.value } : prev))}
              />
              <textarea
                className="min-h-28 w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.body}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, body: e.target.value } : prev))}
              />
              <input
                type="datetime-local"
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.send_at.slice(0, 16)}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, send_at: new Date(e.target.value).toISOString() } : prev))
                }
              />
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.channel}
                onChange={(e) => setEditingMessage((prev) => (prev ? { ...prev, channel: e.target.value as 'email' | 'sms' } : prev))}
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
              </select>
              <select
                className="w-full rounded border border-[#dddbda] px-3 py-2 text-sm"
                value={editingMessage.status}
                onChange={(e) =>
                  setEditingMessage((prev) => (prev ? { ...prev, status: e.target.value as ScheduledMessage['status'] } : prev))
                }
              >
                <option value="pending">Pending</option>
                <option value="sent">Sent</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => void saveScheduledMessage()}
                className="w-full rounded bg-[#0176d3] px-3 py-2 text-sm font-semibold text-white hover:bg-[#015ba1]"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditingMessage(null)}
                className="w-full rounded bg-[#e5e5e5] px-3 py-2 text-sm font-semibold text-[#3e3e3c] hover:bg-[#d9d9d9]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </SectionLayout>
  );
}
