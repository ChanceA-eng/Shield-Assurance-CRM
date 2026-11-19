'use client';

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createSupabaseBrowserAuthClient } from '../lib/supabase-auth-browser';
import { workspaceFetch } from '../lib/workspace-fetch';
import type { NotificationItem, ShellSummary } from '../lib/shell-summary';
import { CONVERSATION_CHANGED_EVENT } from '../lib/conversation-updates';

export type { NotificationItem } from '../lib/shell-summary';

interface NotificationContextValue {
  /** Open tasks past their due date. */
  overdueCount: number;
  /** Open tasks due today or earlier â€” the live Tasks badge. */
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

const noop = async (): Promise<void> => {};
const DISABLED_NOTIFICATIONS: NotificationContextValue = {
  overdueCount: 0, dueTodayCount: 0, notifications: [], unreadCount: 0, unreadMessages: EMPTY_UNREAD,
  refreshError: null, refresh: noop, markRead: noop, markAllRead: noop,
};

export function NotificationProvider({ children, enabled = true }: { children: React.ReactNode; enabled?: boolean }): JSX.Element {
  return enabled ? <ActiveNotificationProvider>{children}</ActiveNotificationProvider>
    : <NotificationContext.Provider value={DISABLED_NOTIFICATIONS}>{children}</NotificationContext.Provider>;
}

function ActiveNotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const publicPage = pathname === '/login' || pathname === '/auth/accept' || pathname.startsWith('/appointments/manage/') || pathname.startsWith('/intelligence/questionnaire/') || pathname.startsWith('/secure-intake/');
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
    if (publicPage) return;
    if (refreshing.current) {
      refreshPending.current = true;
      return refreshing.current;
    }
    refreshing.current = (async () => {
      do {
        refreshPending.current = false;
        try {
          const summary = await workspaceFetch<ShellSummary>('/api/shell');
          setOverdueCount(summary.overdueCount);
          setDueTodayCount(summary.dueTodayCount);
          setNotifications(summary.notifications);
          setUnreadCount(summary.unreadCount);
          setUnreadMessages(summary.unreadMessages);
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
    if (publicPage) return;
    void refresh();
    let debounce: number | undefined;
    const scheduleRefresh = (): void => {
      if (document.visibilityState === 'hidden') return;
      window.clearTimeout(debounce);
      debounce = window.setTimeout(() => { void refresh(); }, 250);
    };
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') void refresh();
    }, 30000);
    const onMessagesRead = (): void => {
      void refresh();
    };
    window.addEventListener(MESSAGES_READ_EVENT, onMessagesRead);
    document.addEventListener('visibilitychange', scheduleRefresh);

    const channel = supabase
      ?.channel('global-crm-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        scheduleRefresh();
        window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        scheduleRefresh();
        window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
      })
      .subscribe((status, failure) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.error('[notifications] Realtime unavailable; automatic polling remains enabled.', failure ?? status);
        }
      });

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(debounce);
      window.removeEventListener(MESSAGES_READ_EVENT, onMessagesRead);
      document.removeEventListener('visibilitychange', scheduleRefresh);
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [supabase, publicPage]);

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
