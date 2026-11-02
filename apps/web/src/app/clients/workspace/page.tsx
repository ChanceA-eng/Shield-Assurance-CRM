import { redirect } from 'next/navigation';
import type { Route } from 'next';

export default async function LegacyWorkspacePage({
  searchParams,
}: { searchParams: Promise<{ lead?: string }> }): Promise<never> {
  const { lead } = await searchParams;
  redirect((lead ? `/leads?lead=${encodeURIComponent(lead)}` : '/clients') as Route);
}
