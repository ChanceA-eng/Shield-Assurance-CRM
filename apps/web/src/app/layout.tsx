import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import './globals.css';
import RashiWidget from '../components/rashi/rashi-widget';
import { createSupabaseServerAuthClient } from '../lib/supabase-auth-server';

export const metadata: Metadata = {
  title: 'Shield Assurance CRM',
  description: 'Enterprise CRM operating system for modern insurance agencies.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const isPublicRoute = cookieStore.get('shield-public-route')?.value === '1';

  if (!isPublicRoute) {
    const supabase = await createSupabaseServerAuthClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      redirect('/login');
    }
  }

  return (
    <html lang="en">
      <body>
        {children}
        {isPublicRoute ? null : <RashiWidget />}
      </body>
    </html>
  );
}
