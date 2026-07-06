'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from './nav-items';
import { useNav } from '../../context/NavContext';
import { useNotifications } from '../../context/NotificationContext';

function sectionTitle(section: 'Core' | 'Insurance Ops' | 'Admin'): string {
  return section;
}

export default function SidebarNav(): JSX.Element {
  const pathname = usePathname();
  const { isNavOpen, closeNav } = useNav();
  const { leadsCount, clientsCount } = useNotifications();

  const grouped = {
    Core: navItems.filter((item) => item.group === 'Core'),
    'Insurance Ops': navItems.filter((item) => item.group === 'Insurance Ops'),
    Admin: navItems.filter((item) => item.group === 'Admin'),
  };

  const badgeCountsByPath: Partial<Record<string, number>> = {
    '/leads': leadsCount,
    '/clients': clientsCount,
  };

  function renderBadge(count: number | undefined, active: boolean): JSX.Element | null {
    if (typeof count !== 'number' || count <= 0) {
      return null;
    }

    const badgeClassName = active
      ? 'bg-white/15 text-white'
      : 'bg-[#d92d20] text-white';

    return (
      <span className={`ml-2 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold ${badgeClassName}`}>
        {count > 99 ? '99+' : count}
      </span>
    );
  }

  return (
    <>
      {isNavOpen ? <button aria-label="Close navigation drawer" className="fixed inset-0 z-40 bg-slate-950/45 backdrop-blur-[1px] lg:hidden" type="button" onClick={closeNav} /> : null}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[248px] flex-shrink-0 flex-col border-r border-[#081a30] bg-[#0b2545] py-3 text-slate-200 shadow-2xl transition-transform duration-300 ease-in-out ${
          isNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-start justify-between gap-3 px-4 pb-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Shield Assurance</p>
            <p className="mt-1 text-lg font-bold text-white">CRM</p>
          </div>

          <button
            type="button"
            onClick={closeNav}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-semibold text-slate-200 transition hover:bg-white/10 hover:text-white"
          >
            Close
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2">
          {(Object.keys(grouped) as Array<'Core' | 'Insurance Ops' | 'Admin'>).map((section) => (
            <div key={section} className="mb-4">
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                {sectionTitle(section)}
              </p>
              <ul className="space-y-1">
                {grouped[section].map((item) => {
                  const isActive = pathname === item.path;
                  const badgeCount = badgeCountsByPath[item.path];

                  return (
                    <li key={item.path}>
                      <div className="flex items-center gap-2">
                        <Link
                          href={item.path}
                          className={`flex flex-1 items-center justify-between rounded-md px-3 py-2 text-sm transition ${
                            isActive
                              ? 'bg-[#1b3e6b] font-semibold text-white'
                              : 'text-slate-300 hover:bg-[#13335c] hover:text-white'
                          }`}
                          onClick={closeNav}
                        >
                          <span className="flex min-w-0 items-center truncate">
                            <span>{item.label}</span>
                            {renderBadge(badgeCount, isActive)}
                          </span>
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="px-3 pt-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-400 bg-slate-500 text-xs font-bold text-white">
            CR
          </div>
        </div>
      </aside>
    </>
  );
}
