'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navItems } from './nav-items';

function sectionTitle(section: 'Core' | 'Insurance Ops' | 'Admin'): string {
  return section;
}

export default function SidebarNav(): JSX.Element {
  const pathname = usePathname();

  const grouped = {
    Core: navItems.filter((item) => item.group === 'Core'),
    'Insurance Ops': navItems.filter((item) => item.group === 'Insurance Ops'),
    Admin: navItems.filter((item) => item.group === 'Admin'),
  };

  return (
    <aside className="z-20 flex w-[248px] flex-shrink-0 flex-col border-r border-[#081a30] bg-[#0b2545] py-3 text-slate-200 shadow-xl">
      <div className="px-4 pb-3">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-300">Shield Assurance</p>
        <p className="mt-1 text-lg font-bold text-white">CRM</p>
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

                return (
                  <li key={item.path}>
                    <Link
                      href={item.path}
                      className={`block rounded-md px-3 py-2 text-sm transition ${
                        isActive
                          ? 'bg-[#1b3e6b] font-semibold text-white'
                          : 'text-slate-300 hover:bg-[#13335c] hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
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
  );
}
