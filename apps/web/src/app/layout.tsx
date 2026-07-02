import type { Metadata } from 'next';
import './globals.css';
import RashiWidget from '../components/rashi/rashi-widget';

export const metadata: Metadata = {
  title: 'Shield Assurance CRM',
  description: 'Enterprise CRM operating system for modern insurance agencies.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RashiWidget />
      </body>
    </html>
  );
}
