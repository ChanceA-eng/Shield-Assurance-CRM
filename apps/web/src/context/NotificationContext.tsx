'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
  refreshError: string | null;
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
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
    try {
      const [overdue, due, feed, unread] = await Promise.all([
        workspaceFetch<{ count: number }>('/api/tasks?status=overdue&count=true'),
        workspaceFetch<{ count: number }>('/api/tasks?status=open&due=today&count=true'),
        workspaceFetch<NotificationItem[]>('/api/notifications'),
        workspaceFetch<{ count: number }>('/api/notifications?count=true'),
      ]);
      setOverdueCount(overdue.count);
      setDueTodayCount(due.count);
      setNotifications(feed);
      setUnreadCount(unread.count);
      setRefreshError(null);
    } catch (failure) {
      setRefreshError(failure instanceof Error ? failure.message : 'Unable to refresh notifications.');
    }
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
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 30000);

    const channel = supabase
      ?.channel('global-crm-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, () => {
        void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, () => {
        void refresh();
      })
      .subscribe();

    return () => {
      window.clearInterval(intervalId);
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [supabase]);

  return (
    <NotificationContext.Provider value={{ overdueCount, dueTodayCount, notifications, unreadCount, refreshError, refresh, markRead, markAllRead }}>
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
