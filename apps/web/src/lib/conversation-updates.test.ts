import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONVERSATION_CHANGED_EVENT, watchConversationUpdates } from './conversation-updates';

describe('automatic conversation updates', () => {
  let visible: string;
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    visible = 'visible';
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    Object.defineProperty(documentTarget, 'visibilityState', { get: () => visible });
    vi.stubGlobal('document', documentTarget);
    vi.stubGlobal('window', Object.assign(windowTarget, {
      setTimeout, clearTimeout, setInterval, clearInterval,
    }));
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('debounces realtime signals and also polls without a user refresh', async () => {
    const refresh = vi.fn(async () => {});
    stop = watchConversationUpdates(refresh);
    window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
    window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(14850);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('pauses hidden views and catches up on focus or visibility', async () => {
    const refresh = vi.fn(async () => {});
    stop = watchConversationUpdates(refresh);
    visible = 'hidden';
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).not.toHaveBeenCalled();
    visible = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('queues an update arriving during a fetch without overlapping requests', async () => {
    let finish: (() => void) | undefined;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; })).mockResolvedValue(undefined);
    stop = watchConversationUpdates(refresh);
    window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(150);
    window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('removes all listeners and timers when the conversation closes', async () => {
    const refresh = vi.fn(async () => {});
    stop = watchConversationUpdates(refresh);
    window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
    stop();
    window.dispatchEvent(new Event(CONVERSATION_CHANGED_EVENT));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
