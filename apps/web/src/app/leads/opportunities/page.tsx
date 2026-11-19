import { redirect } from 'next/navigation';
import Link from 'next/link';
import { businessIntelligenceHref } from '../../../lib/task-links';
import { isUuid } from '../../../lib/workspace-validation';

export default async function OpportunityPage({ searchParams }: {
  searchParams: Promise<{ type?: string; id?: string }>;
}): Promise<JSX.Element> {
  const { type, id } = await searchParams;
  if ((type === 'lead' || type === 'client') && isUuid(id)) {
    redirect(businessIntelligenceHref({ type, id }));
  }
  if (type !== undefined || id !== undefined) return <div className="space-y-3 p-4">
    <p role="alert">This business link is invalid. Open the correct lead or account.</p>
    <Link className="text-sm text-cui-primary underline" href="/leads?view=queue&reviews=1">Open Work Queue</Link>
  </div>;
  redirect('/leads?view=queue&reviews=1');
}
