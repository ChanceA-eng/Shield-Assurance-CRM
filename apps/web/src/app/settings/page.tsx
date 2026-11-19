import Link from 'next/link';
import { redirect } from 'next/navigation';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import SettingsWorkspace from '../../components/crm/SettingsWorkspace';
import { createSupabaseServerAuthClient } from '../../lib/supabase-auth-server';
import { getSupabaseServerClient } from '../../lib/supabase-server';
import { accountMembership } from '../../lib/agency-access';
import SalesTemplateSettings from '../../components/crm/SalesTemplateSettings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<JSX.Element> {
  const auth = await createSupabaseServerAuthClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) redirect('/login');
  const db = getSupabaseServerClient();
  if (!db) return <SectionLayout title="Settings"><p role="alert" className="text-sm text-cui-danger">Database unavailable. Contact support.</p></SectionLayout>;
  const member = await accountMembership(db, user.id);
  if (member?.active && member.role === 'admin') return <SectionLayout title="Settings">
    <SalesTemplateSettings />
  </SectionLayout>;
  if (!member?.active || member.role !== 'owner') return <SectionLayout title="Settings">
    <Card><CardHeader>Agency settings are owner-only</CardHeader><CardBody>
      <Link href="/account" className="text-sm font-semibold text-cui-primary underline">Open My Account</Link>
    </CardBody></Card>
  </SectionLayout>;
  return <SectionLayout title="Settings">
    <SettingsWorkspace />
  </SectionLayout>;
}
