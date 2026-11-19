'use client';

import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import AppHeader from './AppHeader';
import AppSidebar from './AppSidebar';
import NewLeadBanner from './NewLeadBanner';
import { useStaffWorkspace } from '../../context/StaffWorkspaceContext';
const RashiWidget = dynamic(() => import('../rashi/rashi-widget'), { ssr: false });

export default function AppShell({ children }: { children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();
  const full = useStaffWorkspace() === 'full';

  if (pathname === '/login' || pathname.startsWith('/auth/') || pathname.startsWith('/appointments/manage/') || pathname.startsWith('/intelligence/questionnaire/') || pathname.startsWith('/secure-intake/')) {
    return <>{children}</>;
  }

  return (
    <>
      <div className="crm-shell flex h-dvh w-full flex-col overflow-hidden text-cui-text">
        <AppHeader />
        {full ? <NewLeadBanner /> : null}
        <div className="relative flex flex-1 flex-row overflow-hidden">
          <AppSidebar />
          <main id="crm-main" className="min-w-0 flex-1 overflow-y-auto bg-cui-body">{children}</main>
        </div>
      </div>
      {full ? <RashiWidget /> : null}
    </>
  );
}
