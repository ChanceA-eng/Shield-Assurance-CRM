'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bell, BellRing, ChevronDown, ClipboardList, LogOut, Menu, MessageSquare, Shield, User, UserPlus } from 'lucide-react';
import { useNav } from '../../context/NavContext';
import { useNotifications } from '../../context/NotificationContext';
import { createSupabaseBrowserAuthClient } from '../../lib/supabase-auth-browser';
import { navigationBreadcrumbs, navigationFallback } from '../../lib/workspace-navigation';
import { useWorkspaceNavigation } from '../../context/WorkspaceNavigationContext';
import { useStaffRecords, useStaffWorkspace } from '../../context/StaffWorkspaceContext';
import { staffRecords } from '../../lib/staff-records';

function relativeTime(value: string): string {
  const date = new Date(value).getTime();
  if (Number.isNaN(date)) return value;
  const minutes = Math.floor((Date.now() - date) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Breadcrumbs(): JSX.Element {
  const pathname = usePathname();
  const breadcrumbs = navigationBreadcrumbs(pathname);

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 lg:block"><ol className="flex items-center gap-1.5 text-sm text-cui-muted">
      {breadcrumbs.map(({ href, label }, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <li key={href} className="flex items-center gap-1.5">
            {index ? <span className="text-cui-border">/</span> : null}
            {isLast ? (
              <span aria-current="page" className="font-medium text-cui-text">{label}</span>
            ) : (
              <Link href={href as Route} className="hover:text-cui-primary">
                {label}
              </Link>
            )}
          </li>
        );
      })}
    </ol></nav>
  );
}

export default function AppHeader(): JSX.Element {
  const { toggleNav } = useNav();
  const pathname = usePathname();
  const { back, previousHref, confirmLeave } = useWorkspaceNavigation();
  const workspace = useStaffWorkspace();
  const [firstRecord] = useStaffRecords();
  const full = workspace === 'full';
  const landing = firstRecord ? staffRecords[firstRecord].href : workspace === 'account' ? '/account' : '/communication/social';
  const { overdueCount, notifications, unreadCount, refreshError, refresh, markRead, markAllRead } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountMenuReady, setAccountMenuReady] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const notificationCount = overdueCount + unreadCount;

  useEffect(() => {
    setAccountMenuReady(true);
    try {
      const supabase = createSupabaseBrowserAuthClient();
      let disposed = false;
      const loadIdentity = (): void => {
        void supabase.auth.getUser().then(({ data, error }) => {
          if (disposed) return;
          if (error) console.error('[header/account]', error.code);
          setEmail(data.user?.email ?? null);
          setDisplayName(typeof data.user?.user_metadata.full_name === 'string' ? data.user.user_metadata.full_name : '');
        });
      };
      loadIdentity();
      const { data: listener } = supabase.auth.onAuthStateChange(() => { window.setTimeout(loadIdentity, 0); });
      window.addEventListener('crm:account-updated', loadIdentity);
      return () => { disposed = true; listener.subscription.unsubscribe(); window.removeEventListener('crm:account-updated', loadIdentity); };
    } catch (failure) {
      console.error('[header/account] Identity could not load', failure);
      setEmail(null); setDisplayName('');
    }
  }, []);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const signOut = async (): Promise<void> => {
    if (!confirmLeave()) return;
    try {
      const supabase = createSupabaseBrowserAuthClient();
      await supabase.auth.signOut();
    } catch {
      // Proceed to login regardless; middleware will enforce auth state.
    }
    window.location.assign('/login');
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-cui-border bg-cui-panel px-3 shadow-card sm:gap-3 sm:px-4">
      <a href="#crm-main" className="sr-only z-50 focus:not-sr-only focus:absolute focus:left-3 focus:top-2 focus:rounded-lg focus:bg-cui-panel focus:px-3 focus:py-2 focus:text-cui-text">Skip to content</a>
      <Link href={full ? '/' : landing} prefetch={full ? undefined : false} className="flex items-center gap-2 pr-2">
        <Shield className="h-6 w-6 text-cui-primary" />
        <span className="hidden text-base font-bold tracking-tight text-cui-text sm:inline">
          Shield <span className="font-normal text-cui-muted">Assurance</span>
        </span>
      </Link>

      <button
        type="button"
        onClick={toggleNav}
        aria-label="Toggle navigation"
        className="rounded p-1.5 text-cui-muted transition hover:bg-cui-light hover:text-cui-text"
      >
        <Menu className="h-5 w-5" />
      </button>

      {full && (pathname !== '/' || previousHref) ? <button type="button" onClick={back} aria-label="Back"
        title={`Back to ${previousHref ?? navigationFallback(pathname)}`}
        className="inline-flex shrink-0 items-center gap-1 rounded px-2 py-1.5 text-sm font-semibold text-cui-muted hover:bg-cui-light hover:text-cui-text">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back
      </button> : null}
      {full ? <Breadcrumbs /> : null}

      <div className="flex-1" />

      {full ? <div className="relative" ref={bellRef}>
        <button
          type="button"
          onClick={() => setBellOpen((open) => !open)}
          aria-label={`Notifications: ${notificationCount}`}
          className="relative rounded p-1.5 text-cui-muted transition hover:bg-cui-light hover:text-cui-text"
        >
          <Bell className="h-5 w-5" />
          {notificationCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-cui-danger px-1 text-[10px] font-bold text-white">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          ) : null}
        </button>

        {bellOpen ? (
          <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded border border-cui-border/60 bg-white shadow-panel">
            <div className="flex items-center justify-between border-b border-cui-border/40 bg-cui-light px-3 py-2">
              <p className="text-sm font-bold text-cui-text">Notifications</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-xs font-semibold text-cui-primary hover:underline"
                >
                  Mark all read
                </button>
              ) : null}
            </div>
            {refreshError ? <p role="alert" className="border-b border-cui-border px-3 py-2 text-xs text-cui-danger">{refreshError} <button type="button" onClick={() => void refresh()} className="font-semibold underline">Retry</button></p> : null}

            {overdueCount > 0 ? (
              <Link
                href="/tasks"
                onClick={() => setBellOpen(false)}
                className="flex items-center gap-2.5 border-b border-cui-border/40 bg-cui-danger/5 px-3 py-2.5 transition hover:bg-cui-danger/10"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cui-danger/15">
                  <ClipboardList className="h-4 w-4 text-cui-danger" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-cui-text">
                    {overdueCount} overdue task{overdueCount === 1 ? '' : 's'}
                  </span>
                  <span className="block text-xs text-cui-muted">Open Tasks to catch up</span>
                </span>
              </Link>
            ) : null}

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 && overdueCount === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-cui-muted">You&rsquo;re all caught up.</p>
              ) : null}
              {notifications.map((item) => {
                const isLead = item.type.includes('lead');
                const isMessage = item.type.includes('message') || item.type.includes('email') || item.type.includes('sms');
                const Icon = isLead ? UserPlus : isMessage ? MessageSquare : BellRing;
                const tone = isLead ? 'bg-cui-success/15 text-cui-success' : isMessage ? 'bg-cui-info/20 text-cui-info' : 'bg-cui-warning/20 text-amber-700';
                const href = item.href || (isLead ? '/leads' : '/leads?view=queue');
                return (
                  <Link
                    key={item.id}
                    href={href as Route}
                    onClick={() => {
                      if (!item.read) void markRead(item.id);
                      setBellOpen(false);
                    }}
                    className={`flex items-start gap-2.5 border-b border-cui-light px-3 py-2.5 transition last:border-b-0 hover:bg-cui-light/60 ${
                      item.read ? 'opacity-70' : 'bg-cui-primary/5'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${tone}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm text-cui-text ${item.read ? '' : 'font-bold'}`}>{item.message}</span>
                      <span className="mt-0.5 block text-[11px] text-cui-muted">{relativeTime(item.created_at)}</span>
                    </span>
                    {!item.read ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cui-primary" /> : null}
                  </Link>
                );
              })}
            </div>

            <Link
              href="/tasks"
              onClick={() => setBellOpen(false)}
              className="block border-t border-cui-border/40 bg-cui-light px-3 py-2 text-center text-xs font-semibold text-cui-primary hover:underline"
            >
              View all tasks
            </Link>
          </div>
        ) : null}
      </div> : null}

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          aria-label="Account menu"
          aria-expanded={menuOpen}
          disabled={!accountMenuReady}
          className="flex items-center gap-2 rounded p-1.5 transition hover:bg-cui-light"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-cui-primary text-white">
            <User className="h-4 w-4" />
          </span>
          <ChevronDown className="hidden h-3.5 w-3.5 text-cui-muted sm:block" />
        </button>

        {menuOpen ? (
          <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded border border-cui-border/60 bg-white py-1 shadow-panel">
            <p className="border-b border-cui-border/40 bg-cui-light px-4 py-2 text-xs font-semibold text-cui-muted">
              {displayName ? <span className="block text-cui-text">{displayName}</span> : null}
              {email ?? 'Signed in'}
            </p>
            {full ? <Link
              href="/account"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-cui-text hover:bg-cui-light"
            >
              <User className="h-4 w-4 text-cui-muted" />
              My Account
            </Link> : <a href="/account" className="flex items-center gap-2 px-4 py-2 text-sm text-cui-text hover:bg-cui-light">
              <User className="h-4 w-4 text-cui-muted" />My Account
            </a>}
            <button
              type="button"
              onClick={() => void signOut()}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-cui-text hover:bg-cui-light"
            >
              <LogOut className="h-4 w-4 text-cui-muted" />
              Sign out
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
