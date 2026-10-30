'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
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
  UserPlus,
  Users,
} from 'lucide-react';
import { navigationCategories, type NavCategory } from '../../config/navigation';
import { useNav } from '../../context/NavContext';
import { useNotifications } from '../../context/NotificationContext';

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

function categoryContainsPath(category: NavCategory, pathname: string): boolean {
  if (!category.sections) return category.href === pathname;
  return category.sections.some((section) =>
    section.items.some((item) => item.href !== '/' && pathname.startsWith(item.href)),
  );
}

export default function AppSidebar(): JSX.Element {
  const pathname = usePathname();
  const { isNavOpen, closeNav } = useNav();
  const { dueTodayCount } = useNotifications();
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const active = navigationCategories.find((cat) => categoryContainsPath(cat, pathname));
    return new Set(active ? [active.id] : []);
  });

  // Auto-open the group for the current route on navigation
  useEffect(() => {
    const active = navigationCategories.find((cat) => categoryContainsPath(cat, pathname));
    if (active) {
      setOpenGroups((current) => {
        if (current.has(active.id)) return current;
        const next = new Set(current);
        next.add(active.id);
        return next;
      });
    }
  }, [pathname]);

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

  const sidebarBody = (
    <nav className="flex-1 overflow-y-auto py-2">
      <Link
        href="/"
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
        const isActiveGroup = categoryContainsPath(category, pathname);

        // Section-less categories render as direct links
        if (!category.sections && category.href) {
          const isActive = pathname.startsWith(category.href);
          return (
            <Link
              key={category.id}
              href={category.href as Route}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'border-l-4 border-cui-primary bg-cui-sidebar-item pl-3 font-semibold text-white'
                  : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{category.label}</span>
              {category.id === 'tasks' && dueTodayCount > 0 ? (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-cui-danger px-1.5 text-[11px] font-bold text-white">
                  {dueTodayCount > 99 ? '99+' : dueTodayCount}
                </span>
              ) : null}
            </Link>
          );
        }

        return (
          <div key={category.id}>
            <button
              type="button"
              onClick={() => toggleGroup(category.id)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActiveGroup && !isOpen
                  ? 'bg-cui-sidebar-item text-white'
                  : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{category.label}</span>
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
                      const isActive = item.href !== '/' && pathname.startsWith(item.href);
                      return (
                        <Link
                          key={`${item.href}-${item.label}`}
                          href={item.href as Route}
                          className={`flex items-center py-2 pl-11 pr-4 text-[13px] transition-colors ${
                            isActive
                              ? 'border-l-4 border-cui-primary bg-cui-sidebar-item pl-10 font-semibold text-white'
                              : 'text-cui-sidebar-text hover:bg-cui-sidebar-item hover:text-white'
                          }`}
                        >
                          {item.label}
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
