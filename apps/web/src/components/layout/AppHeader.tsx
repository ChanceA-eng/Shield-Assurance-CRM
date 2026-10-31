'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Bell, BellRing, ChevronDown, ClipboardList, LogOut, Menu, MessageSquare, Settings, Shield, User, UserPlus } from 'lucide-react';
import { useNav } from '../../context/NavContext';
import { useNotifications } from '../../context/NotificationContext';
import { createSupabaseBrowserAuthClient } from '../../lib/supabase-auth-browser';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function titleize(segment: string): string {
  if (UUID_PATTERN.test(segment)) return 'Detail';
  return segment
    .split('-')
    .map((word) => (word.length > 0 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

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
  const segments = pathname.split('/').filter(Boolean);

  return (
    <ol className="hidden items-center gap-1.5 text-sm text-cui-muted lg:flex">
      <li>
        <Link href="/" className="hover:text-cui-primary">
          Home
        </Link>
      </li>
      {segments.map((segment, index) => {
        const href = `/${segments.slice(0, index + 1).join('/')}`;
        const isLast = index === segments.length - 1;
        return (
          <li key={href} className="flex items-center gap-1.5">
            <span className="text-cui-border">/</span>
            {isLast ? (
              <span className="font-medium text-cui-text">{titleize(segment)}</span>
            ) : (
              <Link href={href as Route} className="hover:text-cui-primary">
                {titleize(segment)}
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function AppHeader(): JSX.Element {
  const { toggleNav } = useNav();
  const { overdueCount, notifications, unreadCount, refreshError, refresh, markRead, markAllRead } = useNotifications();
  const [menuOpen, setMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  const notificationCount = overdueCount + unreadCount;

  useEffect(() => {
    try {
      const supabase = createSupabaseBrowserAuthClient();
      void supabase.auth.getUser().then(({ data }) => {
        setEmail(data.user?.email ?? null);
      });
    } catch {
      setEmail(null);
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
    try {
      const supabase = createSupabaseBrowserAuthClient();
      await supabase.auth.signOut();
    } catch {
      // Proceed to login regardless; middleware will enforce auth state.
    }
    window.location.assign('/login');
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-cui-border/60 bg-white px-4 shadow-card">
      <Link href="/" className="flex items-center gap-2 pr-2">
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

      <Breadcrumbs />

      <div className="flex-1" />

      <div className="relative" ref={bellRef}>
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
      </div>

      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
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
              {email ?? 'Signed in'}
            </p>
            <Link
              href="/settings"
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2 px-4 py-2 text-sm text-cui-text hover:bg-cui-light"
            >
              <Settings className="h-4 w-4 text-cui-muted" />
              Settings
            </Link>
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
