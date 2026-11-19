import { redirect } from 'next/navigation';
import { isUuid } from '../../lib/workspace-validation';

export default async function Page({ searchParams }: {
  searchParams: Promise<{ type?: string; id?: string }>;
}): Promise<never> {
  const { type, id } = await searchParams;
  if (isUuid(id) && type === 'client') redirect(`/clients/${id}?intake=1`);
  if (isUuid(id) && type === 'lead') redirect(`/leads?lead=${id}&intake=1`);
  redirect('/leads?intake=1');
}
