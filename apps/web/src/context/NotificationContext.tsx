'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createSupabaseBrowserAuthClient } from '../lib/supabase-auth-browser';
import { workspaceFetch } from '../lib/workspace-fetch';

export interface NotificationItem {
  id: string;
  type: string;
  message: string;
  href: string | null;
  read: boolean;
  created_at: string;
}

interface NotificationContextValue {
  /** Open tasks past their due date. */
  overdueCount: number;
  /** Open tasks due today or earlier — the live Tasks badge. */
  dueTodayCount: number;
  /** Latest unread notification feed for the bell dropdown. */
  notifications: NotificationItem[];
  unreadCount: number;
  /** Unread inbound client/lead messages (email + SMS). */
  unreadMessages: UnreadMessageCounts;
  refreshError: string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

export interface UnreadMessageCounts {
  total: number;
  byClient: Record<string, number>;
  byLead: Record<string, number>;
}

const EMPTY_UNREAD: UnreadMessageCounts = { total: 0, byClient: {}, byLead: {} };

/** Dispatch on window after marking messages read so badges refresh immediately. */
export const MESSAGES_READ_EVENT = 'crm:messages-read';

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const refreshing = useRef<Promise<void> | null>(null);
  const refreshPending = useRef(false);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState<UnreadMessageCounts>(EMPTY_UNREAD);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserAuthClient();
    } catch (failure) {
      console.error('[notifications] Realtime setup failed; polling remains enabled.', failure);
      return null;
    }
  }, []);

  const refresh = async (): Promise<void> => {
    if (pathname === '/login') return;
    if (refreshing.current) {
      refreshPending.current = true;
      return refreshing.current;
    }
    refreshing.current = (async () => {
      do {
        refreshPending.current = false;
        try {
          const [overdue, due, feed, unread, messages] = await Promise.all([
            workspaceFetch<{ count: number }>('/api/tasks?status=overdue&count=true'),
            workspaceFetch<{ count: number }>('/api/tasks?status=open&due=today&count=true'),
            workspaceFetch<NotificationItem[]>('/api/notifications'),
            workspaceFetch<{ count: number }>('/api/notifications?count=true'),
            workspaceFetch<UnreadMessageCounts>('/api/communication-log/unread'),
          ]);
          setOverdueCount(overdue.count);
          setDueTodayCount(due.count);
          setNotifications(feed);
          setUnreadCount(unread.count);
          setUnreadMessages(messages);
          setRefreshError(null);
        } catch (failure) {
          setRefreshError(failure instanceof Error ? failure.message : 'Unable to refresh notifications.');
        }
      } while (refreshPending.current);
    })();
    try { await refreshing.current; } finally { refreshing.current = null; }
  };

  const markRead = async (id: string): Promise<void> => {
    try {
      await workspaceFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      await refresh();
    } catch (failure) {
      setRefreshError(failure instanceof Error ? failure.message : 'Unable to mark this notification read.');
    }
  };

  const markAllRead = async (): Promise<void> => {
    try {
      await workspaceFetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      await refresh();
    } catch (failure) {
      setRefreshError(failure instanceof Error ? failure.message : 'Unable to mark notifications read.');
    }
  };

  useEffect(() => {
    if (pathname === '/login') return;
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 30000);
    const onMessagesRead = (): void => {
      void refresh();
    };
    window.addEventListener(MESSAGES_READ_EVENT, onMessagesRead);

    const channel = supabase
      ?.channel('global-crm-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void refresh();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communication_log' }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(MESSAGES_READ_EVENT, onMessagesRead);
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [supabase, pathname === '/login']);

  return (
    <NotificationContext.Provider value={{ overdueCount, dueTodayCount, notifications, unreadCount, unreadMessages, refreshError, refresh, markRead, markAllRead }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider.');
  }

  return context;
}
