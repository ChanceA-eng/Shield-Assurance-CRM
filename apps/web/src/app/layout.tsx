import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
import AppShell from '../components/layout/AppShell';
import { NavProvider } from '../context/NavContext';
import { NotificationProvider } from '../context/NotificationContext';
import { WorkspaceNavigationProvider } from '../context/WorkspaceNavigationContext';
import { StaffWorkspaceProvider } from '../context/StaffWorkspaceContext';
import { POLICY_ADMIN_HEADER, readStaffTeamAccess, readStaffWorkspace, STAFF_TEAM_ACCESS_HEADER, STAFF_TRAINING_HEADER, STAFF_WORKSPACE_HEADER, TEAM_MANAGER_HEADER } from '../lib/staff-workspace';
import { readStaffRecords, STAFF_RECORDS_HEADER } from '../lib/staff-records';

export const metadata: Metadata = {
  title: 'Shield Assurance CRM',
  description: 'Enterprise CRM operating system for modern insurance agencies.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const workspace = readStaffWorkspace(requestHeaders.get(STAFF_WORKSPACE_HEADER));
  const records = readStaffRecords(requestHeaders.get(STAFF_RECORDS_HEADER));
  const access = readStaffTeamAccess(requestHeaders.get(STAFF_TEAM_ACCESS_HEADER));
  return (
    <html lang="en">
      <body className="bg-cui-body text-cui-text antialiased">
        <StaffWorkspaceProvider workspace={workspace} records={records} policyAdmin={requestHeaders.get(POLICY_ADMIN_HEADER) === 'true'}
          teamManager={requestHeaders.get(TEAM_MANAGER_HEADER) === 'true'} training={requestHeaders.get(STAFF_TRAINING_HEADER) === 'true'} access={access}>
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
