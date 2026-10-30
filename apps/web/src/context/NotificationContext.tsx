'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserAuthClient } from '../lib/supabase-auth-browser';

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
  refresh: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueTodayCount, setDueTodayCount] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);

  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserAuthClient();
    } catch {
      return null;
    }
  }, []);

  const refresh = async (): Promise<void> => {
    try {
      const [overdueRes, dueRes, notifRes] = await Promise.all([
        fetch('/api/tasks?status=overdue&limit=200', { cache: 'no-store' }),
        fetch('/api/tasks?status=open&due=today&limit=200', { cache: 'no-store' }),
        fetch('/api/notifications', { cache: 'no-store' }),
      ]);

      if (overdueRes.ok) {
        const rows = (await overdueRes.json()) as unknown[];
        setOverdueCount(Array.isArray(rows) ? rows.length : 0);
      }
      if (dueRes.ok) {
        const rows = (await dueRes.json()) as unknown[];
        setDueTodayCount(Array.isArray(rows) ? rows.length : 0);
      }
      if (notifRes.ok) {
        const rows = (await notifRes.json()) as NotificationItem[];
        // Full recent feed — read items stay visible, just not bold.
        setNotifications(Array.isArray(rows) ? rows.slice(0, 25) : []);
      }
    } catch {
      // Keep existing values if refresh fails.
    }
  };

  const markRead = async (id: string): Promise<void> => {
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
    } catch {
      // best effort
    }
  };

  const markAllRead = async (): Promise<void> => {
    setNotifications((current) => current.map((item) => ({ ...item, read: true })));
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
    } catch {
      // best effort
    }
  };

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 60000);

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
    <NotificationContext.Provider value={{ overdueCount, dueTodayCount, notifications, refresh, markRead, markAllRead }}>
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
