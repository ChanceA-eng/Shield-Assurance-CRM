'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { isWorkspacePath, navigationFallback, shouldGuardLink } from '../lib/workspace-navigation';

const storageKey = 'crm:navigation';
const stateKey = '__crmNavigation';
const discardMessage = 'Leave this page? Unsaved changes will be lost.';
interface Trail { token: string; entries: string[]; index: number }
interface Marker { token: string; index: number }
interface Navigation {
  previousHref: string | null;
  back: () => void;
  navigate: (href: string) => void;
  confirmLeave: () => boolean;
  confirmDiscard: () => boolean;
  register: (id: symbol, dirty: () => boolean) => () => void;
}
const Context = createContext<Navigation | null>(null);
const hrefNow = (): string => `${window.location.pathname}${window.location.search}${window.location.hash}`;

function marker(value: unknown): Marker | null {
  if (!value || typeof value !== 'object' || !(stateKey in value)) return null;
  const candidate: unknown = value[stateKey];
  if (!candidate || typeof candidate !== 'object' || !('token' in candidate) || !('index' in candidate)) return null;
  return typeof candidate.token === 'string' && Number.isInteger(candidate.index) && Number(candidate.index) >= 0
    ? { token: candidate.token, index: Number(candidate.index) } : null;
}

function readTrail(): Trail | null {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return null;
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || !('token' in value) || !('entries' in value) || !('index' in value)
    || typeof value.token !== 'string' || !Array.isArray(value.entries)
    || !value.entries.every((entry: unknown) => typeof entry === 'string' && isWorkspacePath(entry) && !entry.includes('\\'))
    || !Number.isInteger(value.index) || Number(value.index) < 0 || Number(value.index) >= value.entries.length) {
    throw new Error('Stored navigation history is invalid.');
  }
  return { token: value.token, entries: value.entries, index: Number(value.index) };
}

export function WorkspaceNavigationProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const router = useRouter();
  const guards = useRef(new Map<symbol, () => boolean>());
  const approved = useRef(false);
  const trail = useRef<Trail | null>(null);
  const [previousHref, setPreviousHref] = useState<string | null>(null);
  const confirmDiscard = useCallback((): boolean =>
    ![...guards.current.values()].some((dirty) => dirty()) || window.confirm(discardMessage), []);
  const confirmLeave = useCallback((): boolean => {
    if (!confirmDiscard()) return false;
    approved.current = true;
    return true;
  }, [confirmDiscard]);
  const register = useCallback((id: symbol, dirty: () => boolean): (() => void) => {
    guards.current.set(id, dirty);
    return () => { guards.current.delete(id); };
  }, []);

  useEffect(() => {
    const currentHref = hrefNow();
    let stored: Trail | null = null;
    try { stored = readTrail(); }
    catch (failure) { console.warn('[navigation/history] Could not restore return path.', failure); }
    const currentMarker = marker(window.history.state);
    if (stored && currentMarker?.token === stored.token && stored.entries[currentMarker.index] === currentHref) {
      trail.current = { ...stored, index: currentMarker.index };
    } else {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      const fromWorkspace = stored && referrer?.origin === window.location.origin
        && `${referrer.pathname}${referrer.search}${referrer.hash}` === stored.entries[stored.index] && window.history.length > 1;
      trail.current = stored && fromWorkspace && isWorkspacePath(currentHref)
        ? { ...stored, entries: [...stored.entries.slice(0, stored.index + 1), currentHref], index: stored.index + 1 }
        : { token: crypto.randomUUID(), entries: [isWorkspacePath(currentHref) ? currentHref : '/'], index: 0 };
    }
    let storageFailed = false;
    const publish = (): void => {
      const value = trail.current;
      if (!value) return;
      setPreviousHref(value.index > 0 ? value.entries[value.index - 1] : null);
      if (!storageFailed) {
        try { sessionStorage.setItem(storageKey, JSON.stringify(value)); }
        catch (failure) { storageFailed = true; console.warn('[navigation/history] Return paths will not survive reload.', failure); }
      }
    };
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    // Keep Next's router state intact while identifying this tab's history entries.
    const withMarker = (data: unknown, value: Trail): object => ({
      ...(data && typeof data === 'object' ? data : {}), [stateKey]: { token: value.token, index: value.index },
    });
    const record = (push: boolean, data: unknown, unused: string, url?: string | URL | null): void => {
      const target = new URL(url?.toString() ?? window.location.href, window.location.href);
      const value = trail.current;
      const original = push ? originalPush : originalReplace;
      if (!value || target.origin !== window.location.origin || !isWorkspacePath(target.pathname)) {
        original.call(window.history, data, unused, url);
        return;
      }
      const href = `${target.pathname}${target.search}${target.hash}`;
      const index = push ? value.index + 1 : value.index;
      const entries = push ? [...value.entries.slice(0, index), href] : value.entries.map((entry, position) => position === index ? href : entry);
      const next = { ...value, entries, index };
      original.call(window.history, withMarker(data, next), unused, url);
      trail.current = next;
      approved.current = false;
      publish();
    };
    const push: History['pushState'] = (data: unknown, unused: string, url?: string | URL | null) => record(true, data, unused, url);
    const replace: History['replaceState'] = (data: unknown, unused: string, url?: string | URL | null) => record(false, data, unused, url);
    window.history.pushState = push;
    window.history.replaceState = replace;
    if (trail.current && isWorkspacePath(window.location.pathname)) originalReplace.call(window.history, withMarker(window.history.state, trail.current), '', window.location.href);
    publish();
    let restoring = false;
    const pop = (event: PopStateEvent): void => {
      if (restoring) { restoring = false; event.stopImmediatePropagation(); return; }
      const value = trail.current, target = marker(event.state);
      if (!value || !target || target.token !== value.token || !value.entries[target.index]) return;
      if (!approved.current && !confirmLeave()) {
        const delta = value.index - target.index;
        // Restore a cancelled traversal before Next can unmount the dirty editors.
        if (delta) { event.stopImmediatePropagation(); restoring = true; window.history.go(delta); }
        return;
      }
      approved.current = false;
      trail.current = { ...value, index: target.index };
      publish();
    };
    const click = (event: MouseEvent): void => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!event.defaultPrevented && link instanceof HTMLAnchorElement && shouldGuardLink(event, link, window.location.href)) {
        if (!confirmLeave()) { event.preventDefault(); event.stopImmediatePropagation(); }
        else queueMicrotask(() => { if (event.defaultPrevented) approved.current = false; });
      }
    };
    const unload = (event: BeforeUnloadEvent): void => {
      const permitted = approved.current;
      approved.current = false;
      if (!permitted && [...guards.current.values()].some((dirty) => dirty())) {
        event.preventDefault(); event.returnValue = '';
      }
    };
    window.addEventListener('popstate', pop, true);
    document.addEventListener('click', click, true);
    window.addEventListener('beforeunload', unload);
    return () => {
      if (window.history.pushState === push) window.history.pushState = originalPush;
      if (window.history.replaceState === replace) window.history.replaceState = originalReplace;
      window.removeEventListener('popstate', pop, true);
      document.removeEventListener('click', click, true);
      window.removeEventListener('beforeunload', unload);
    };
  }, [confirmLeave]);

  const navigate = useCallback((href: string): void => {
    const target = new URL(href, window.location.origin);
    if (target.origin !== window.location.origin || !isWorkspacePath(target.pathname)) throw new Error('Use a CRM destination for workspace navigation.');
    if (confirmLeave()) router.push(`${target.pathname}${target.search}${target.hash}` as Route);
  }, [confirmLeave, router]);
  const back = useCallback((): void => {
    if (!confirmLeave()) return;
    if (trail.current && trail.current.index > 0) window.history.back();
    else router.push(navigationFallback(window.location.pathname) as Route);
  }, [confirmLeave, router]);
  return <Context.Provider value={{ previousHref, back, navigate, confirmLeave, confirmDiscard, register }}>{children}</Context.Provider>;
}

export function useWorkspaceNavigation(): Navigation {
  const value = useContext(Context);
  if (!value) throw new Error('Workspace navigation requires its provider.');
  return value;
}

export function useUnsavedChanges(dirty: boolean): { markSaved: () => void; confirmDiscard: () => boolean } {
  const { register } = useWorkspaceNavigation();
  const id = useRef(Symbol('unsaved-work'));
  const current = useRef(dirty);
  current.current = dirty;
  useEffect(() => register(id.current, () => current.current), [register]);
  return {
    markSaved: () => { current.current = false; },
    confirmDiscard: () => !current.current || window.confirm('Discard unsaved changes?'),
  };
}
