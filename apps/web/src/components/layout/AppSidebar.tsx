'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CheckSquare,
  ChevronDown,
  DollarSign,
  FileStack,
  LayoutGrid,
  Network,
  Settings,
  User,
  UserPlus,
  Users,
} from 'lucide-react';
import { navigationCategories, activeNavigationHref, type NavCategory } from '../../config/navigation';
import { useNav } from '../../context/NavContext';
import { useNotifications } from '../../context/NotificationContext';
import { useStaffAccess, useStaffWorkspace } from '../../context/StaffWorkspaceContext';
import { canAccessTeamPage } from '../../lib/team-page-access';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  LayoutGrid,
  UserPlus,
  Users,
  FileStack,
  Network,
  DollarSign,
  BarChart3,
  Settings,
  BookOpen,
  CheckSquare,
};

function categoryContainsPath(category: NavCategory, activeHref: string | undefined): boolean {
  if (!category.sections) return category.href === activeHref;
  return category.sections.some((section) =>
    section.items.some((item) => item.href === activeHref),
  );
}

function CountBadge({ count, label }: { count: number; label: string }): JSX.Element {
  return (
    <span
      aria-label={`${count} ${label}`}
      className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cui-danger px-1.5 text-[11px] font-bold text-white"
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidebarNavigation(): JSX.Element {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const activeHref = activeNavigationHref(pathname, search);
  const { isNavOpen, closeNav } = useNav();
  const workspace = useStaffWorkspace();
  const access = useStaffAccess();
  const { dueTodayCount, unreadMessages } = useNotifications();
  const messageCount = unreadMessages.total;
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = navigationCategories.find((cat) => categoryContainsPath(cat, activeHref));
    return new Set(active ? [active.id] : []);
  });

  // Auto-open the group for the current route on navigation
  useEffect(() => {
    const active = navigationCategories.find((cat) => categoryContainsPath(cat, activeHref));
    if (active) {
      setOpenGroups((current) => {
        if (current.has(active.id)) return current;
        const next = new Set(current);
        next.add(active.id);
        return next;
      });
    }
  }, [activeHref]);

  const closeMobileNav = (): void => {
    if (window.matchMedia('(max-width: 767px)').matches) closeNav();
  };

  const toggleGroup = (id: string): void => {
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const sidebarBody = workspace !== 'full' ? (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-2">
      {canAccessTeamPage(access, '/') && <a href="/" onClick={closeMobileNav} className="flex items-center gap-3 px-4 py-2.5 text-sm text-cui-sidebar-text hover:bg-cui-sidebar-item">
        <LayoutGrid className="h-4 w-4 shrink-0" aria-hidden="true" />Dashboard
      </a>}
      {navigationCategories.filter((category) => category.id !== 'settings').map((category) => {
        const links = category.sections?.flatMap((section) => section.items) ?? (category.href ? [{ label: category.label, href: category.href }] : []);
        const visible = links.filter((item) => {
          const target = new URL(item.href, 'https://crm.local');
          return canAccessTeamPage(access, target.pathname, target.searchParams.toString());
        });
        if (!visible.length) return null;
        const Icon = iconMap[category.icon] ?? LayoutGrid;
        return <section key={category.id} aria-label={category.label} className="pb-2">
          <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wider text-cui-muted">{category.label}</p>
          {visible.map((item) => <Link key={item.href} href={item.href as Route} aria-current={item.href === activeHref ? 'page' : undefined}
            onClick={closeMobileNav} className="flex items-center gap-3 px-4 py-2 text-sm text-cui-sidebar-text hover:bg-cui-sidebar-item aria-[current=page]:bg-cui-sidebar-item aria-[current=page]:text-white">
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />{item.label}
          </Link>)}
        </section>;
      })}
      {(['team', 'email', 'automation', 'intelligence', 'permissions', 'integrations'] as const).map((tab) => {
        const href = `/settings?tab=${tab}`;
        if (!canAccessTeamPage(access, '/settings', `tab=${tab}`)) return null;
        const label = tab === 'team' ? 'Team access' : tab === 'email' ? 'Email'
          : tab === 'automation' ? 'Automation' : tab === 'intelligence' ? 'Lead discovery'
            : tab === 'permissions' ? 'Marketing permission' : 'Integrations';
        return <Link key={tab} href={href as Route} onClick={closeMobileNav}
          className="flex items-center gap-3 px-4 py-2 text-sm text-cui-sidebar-text hover:bg-cui-sidebar-item">
          <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />{label}
        </Link>;
      })}
      <Link href="/account" aria-current={pathname === '/account' ? 'page' : undefined} onClick={closeMobileNav}
        className="flex items-center gap-3 px-4 py-2.5 text-sm text-cui-sidebar-text hover:bg-cui-sidebar-item aria-[current=page]:bg-cui-sidebar-item aria-[current=page]:text-white">
        <User className="h-4 w-4 shrink-0" aria-hidden="true" />My Account
      </Link>
    </nav>
  ) : (
    <nav aria-label="Main navigation" className="flex-1 overflow-y-auto py-2">
      <Link
        href="/"
        aria-current={pathname === '/' ? 'page' : undefined}
        onClick={closeMobileNav}
        className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
          pathname === '/'
            ? 'border-l-4 border-cui-primary bg-cui-sidebar-item pl-3 font-semibold text-white'
            : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
        }`}
      >
        <LayoutGrid className="h-4 w-4 shrink-0" />
        <span>Dashboard</span>
      </Link>

      <p className="px-4 pb-1 pt-4 text-[11px] font-bold uppercase tracking-wider text-cui-muted">Menu</p>

      {navigationCategories.map((category) => {
        const Icon = iconMap[category.icon] ?? LayoutGrid;
        const isOpen = openGroups.has(category.id);
        const isActiveGroup = categoryContainsPath(category, activeHref);

        // Section-less categories render as direct links
        if (!category.sections && category.href) {
          const isActive = activeHref === category.href;
          return (
            <Link
              key={category.id}
              href={category.href as Route}
              aria-current={isActive ? 'page' : undefined}
              onClick={closeMobileNav}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'border-l-4 border-cui-primary bg-cui-sidebar-item pl-3 font-semibold text-white'
                  : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{category.label}</span>
              {category.id === 'tasks' && dueTodayCount > 0 ? <CountBadge count={dueTodayCount} label="tasks due" /> : null}
            </Link>
          );
        }

        return (
          <div key={category.id}>
            <button
              type="button"
              onClick={() => toggleGroup(category.id)}
              aria-expanded={isOpen}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActiveGroup && !isOpen
                  ? 'bg-cui-sidebar-item text-white'
                  : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{category.label}</span>
              {category.id === 'communication' && messageCount > 0 ? <CountBadge count={messageCount} label="unread messages" /> : null}
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && category.sections ? (
              <div className="bg-black/20 py-1">
                {category.sections.map((section) => (
                  <div key={section.title}>
                    {category.sections && category.sections.length > 1 ? (
                      <p className="px-11 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wider text-cui-muted">
                        {section.title}
                      </p>
                    ) : null}
                    {section.items.map((item) => {
                      const isActive = item.href === activeHref;
                      return (
                        <Link
                          key={`${item.href}-${item.label}`}
                          href={item.href as Route}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={closeMobileNav}
                          className={`flex items-center py-2 pl-11 pr-4 text-[13px] transition-colors ${
                            isActive
                              ? 'border-l-4 border-cui-primary bg-cui-sidebar-item pl-10 font-semibold text-white'
                              : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
                          }`}
                        >
                          {item.label}
                          {item.href === '/communication' && messageCount > 0 ? (
                            <span className="ml-auto"><CountBadge count={messageCount} label="unread messages" /></span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={`hidden shrink-0 flex-col bg-cui-sidebar transition-all duration-200 md:flex ${
          isNavOpen ? 'w-56' : 'w-0 overflow-hidden'
        }`}
      >
        {sidebarBody}
      </aside>

      {/* Mobile overlay sidebar */}
      {isNavOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={closeNav} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-cui-sidebar shadow-xl">
            {sidebarBody}
          </aside>
        </div>
      ) : null}
    </>
  );
}

export default function AppSidebar(): JSX.Element {
  return <Suspense fallback={<aside className="hidden w-56 shrink-0 bg-cui-sidebar md:block" />}><SidebarNavigation /></Suspense>;
}
