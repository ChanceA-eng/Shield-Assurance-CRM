import type { Metadata } from 'next';
import './globals.css';
import AppShell from '../components/layout/AppShell';
import { NavProvider } from '../context/NavContext';
import { NotificationProvider } from '../context/NotificationContext';

export const metadata: Metadata = {
  title: 'Shield Assurance CRM',
  description: 'Enterprise CRM operating system for modern insurance agencies.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-cui-body text-cui-text antialiased">
        <NotificationProvider>
          <NavProvider>
            <AppShell>{children}</AppShell>
          </NavProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
