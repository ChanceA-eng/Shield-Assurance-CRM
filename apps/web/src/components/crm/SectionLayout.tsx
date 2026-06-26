import React from 'react';
import SidebarNav from './SidebarNav';

export default function SectionLayout({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f3f2f1] font-sans text-[#181818] antialiased">
      <SidebarNav />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-[#dddbda] bg-white px-6 py-3 shadow-sm">
          <h1 className="text-xl font-bold tracking-tight text-[#080707]">{title}</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
