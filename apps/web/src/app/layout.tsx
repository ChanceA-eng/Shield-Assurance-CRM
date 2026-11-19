import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import AppShell from '../components/layout/AppShell';
import { NavProvider } from '../context/NavContext';
import { NotificationProvider } from '../context/NotificationContext';
import { WorkspaceNavigationProvider } from '../context/WorkspaceNavigationContext';
import { StaffWorkspaceProvider } from '../context/StaffWorkspaceContext';
import { POLICY_ADMIN_HEADER, readStaffWorkspace, STAFF_WORKSPACE_HEADER } from '../lib/staff-workspace';
import { readStaffRecords, STAFF_RECORDS_HEADER } from '../lib/staff-records';

export const metadata: Metadata = {
  title: 'Shield Assurance CRM',
  description: 'Enterprise CRM operating system for modern insurance agencies.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const workspace = readStaffWorkspace(requestHeaders.get(STAFF_WORKSPACE_HEADER));
  const records = readStaffRecords(requestHeaders.get(STAFF_RECORDS_HEADER));
  return (
    <html lang="en">
      <body className="bg-cui-body text-cui-text antialiased">
        <StaffWorkspaceProvider workspace={workspace} records={records} policyAdmin={requestHeaders.get(POLICY_ADMIN_HEADER) === 'true'}>
          <NotificationProvider enabled={workspace === 'full'}>
            <NavProvider>
              <WorkspaceNavigationProvider><AppShell>{children}</AppShell></WorkspaceNavigationProvider>
            </NavProvider>
          </NotificationProvider>
        </StaffWorkspaceProvider>
      </body>
    </html>
  );
}
