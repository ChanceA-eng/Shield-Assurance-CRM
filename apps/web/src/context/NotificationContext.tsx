'use client';

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { createSupabaseBrowserAuthClient } from '../lib/supabase-auth-browser';

interface NotificationCounts {
  leadsCount: number;
  clientsCount: number;
}

interface NotificationContextValue extends NotificationCounts {
  refresh: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [counts, setCounts] = useState<NotificationCounts>({ leadsCount: 0, clientsCount: 0 });

  const supabase = useMemo(() => {
    try {
      return createSupabaseBrowserAuthClient();
    } catch {
      return null;
    }
  }, []);

  const refresh = async (): Promise<void> => {
    try {
      const [leadsRes, clientsRes] = await Promise.all([
        fetch('/api/leads?actionableCount=true', { cache: 'no-store' }),
        fetch('/api/clients?actionableCount=true', { cache: 'no-store' }),
      ]);

      const [leadsPayload, clientsPayload] = await Promise.all([
        leadsRes.json().catch(() => ({ count: 0 })) as Promise<{ count?: number }>,
        clientsRes.json().catch(() => ({ count: 0 })) as Promise<{ count?: number }>,
      ]);

      setCounts({
        leadsCount: typeof leadsPayload.count === 'number' ? leadsPayload.count : 0,
        clientsCount: typeof clientsPayload.count === 'number' ? clientsPayload.count : 0,
      });
    } catch {
      // Keep existing values if refresh fails.
    }
  };

  useEffect(() => {
    void refresh();

    const intervalId = window.setInterval(() => {
      void refresh();
    }, 60000);

    const channel = supabase
      ?.channel('global-crm-notifications')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => {
        void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, () => {
        void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'interactions' }, () => {
        void refresh();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'communication_log' }, () => {
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

  return <NotificationContext.Provider value={{ ...counts, refresh }}>{children}</NotificationContext.Provider>;
}

export function useNotifications(): NotificationContextValue {
  const context = useContext(NotificationContext);

  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider.');
  }

  return context;
}