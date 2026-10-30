'use client';

import { usePathname } from 'next/navigation';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import RashiWidget from '../rashi/rashi-widget';

export default function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <>{children}</>;
  }

  return (
    <>
      <div className="flex h-screen w-screen flex-col overflow-hidden">
        <AppHeader />
        <div className="relative flex flex-1 flex-row overflow-hidden">
          <AppSidebar />
          <main className="min-w-0 flex-1 overflow-y-auto bg-cui-body">{children}</main>
        </div>
      </div>
      <RashiWidget />
    </>
  );
}
