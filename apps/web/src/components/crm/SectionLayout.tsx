'use client';

import React from 'react';
import SidebarNav from './SidebarNav';
import { useNav } from '../../context/NavContext';

export default function SectionLayout({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  const { toggleNav } = useNav();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f3f2f1] font-sans text-[#181818] antialiased">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-3 border-b border-[#dddbda] bg-white px-6 py-3 shadow-sm">
          <button
            type="button"
            onClick={toggleNav}
            className="inline-flex items-center rounded-md border border-[#c9c7c5] bg-white px-3 py-2 text-sm font-semibold text-[#080707] shadow-sm transition hover:bg-[#f3f2f1]"
          >
            Menu
          </button>
          <h1 className="text-xl font-bold tracking-tight text-[#080707]">{title}</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
