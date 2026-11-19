export const CONVERSATION_CHANGED_EVENT = 'crm:conversation-changed';

export function watchConversationUpdates(refresh: () => Promise<void>): () => void {
  let disposed = false;
  let busy = false;
  let pending = false;
  let debounce: number | undefined;
  const update = async (): Promise<void> => {
    if (disposed || document.visibilityState !== 'visible') return;
    if (busy) { pending = true; return; }
    busy = true;
    try {
      do {
        pending = false;
        await refresh();
      } while (pending && !disposed && document.visibilityState === 'visible');
    } finally { busy = false; }
  };
  const schedule = (): void => {
    window.clearTimeout(debounce);
    debounce = window.setTimeout(() => { void update(); }, 150);
  };
  const interval = window.setInterval(() => { void update(); }, 15000);
  window.addEventListener(CONVERSATION_CHANGED_EVENT, schedule);
  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  return () => {
    disposed = true;
    window.clearTimeout(debounce);
    window.clearInterval(interval);
    window.removeEventListener(CONVERSATION_CHANGED_EVENT, schedule);
    window.removeEventListener('focus', schedule);
    document.removeEventListener('visibilitychange', schedule);
  };
}
