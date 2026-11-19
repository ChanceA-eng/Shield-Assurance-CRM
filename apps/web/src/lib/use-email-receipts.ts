'use client';

import { useEffect, useState } from 'react';
import type { EmailReceipt } from './message-receipts';
import { workspacePages } from './workspace-fetch';

export function useEmailReceipts(email: string | null | undefined, enabled: boolean): { receipts: EmailReceipt[]; error: string | null } {
  const [result, setResult] = useState<{ email: string; receipts: EmailReceipt[]; error: string | null }>({ email: '', receipts: [], error: null });
  useEffect(() => {
    if (!email || !enabled) return;
    let disposed = false;
    let busy = false;
    const refresh = async (): Promise<void> => {
      if (busy || document.visibilityState !== 'visible') return;
      busy = true;
      try {
        const receipts = await workspacePages<EmailReceipt>(`/api/communication-log/delivery?to_email=${encodeURIComponent(email)}&limit=100`, 100, 'offset');
        if (!disposed) setResult({ email, receipts, error: null });
      } catch (failure) {
        if (!disposed) setResult((current) => ({ email, receipts: current.email === email ? current.receipts : [], error: failure instanceof Error ? failure.message : 'Open status could not be refreshed.' }));
      } finally { busy = false; }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    const visible = (): void => { void refresh(); };
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; window.clearInterval(timer);
      window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible);
    };
  }, [email, enabled]);
  return enabled && result.email === email ? result : { receipts: [], error: null };
}
