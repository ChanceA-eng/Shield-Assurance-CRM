import Link from 'next/link';
import { redirect } from 'next/navigation';
import SectionLayout from '../../components/crm/SectionLayout';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import SettingsWorkspace from '../../components/crm/SettingsWorkspace';
import { createSupabaseServerAuthClient } from '../../lib/supabase-auth-server';
import { getSupabaseServerClient } from '../../lib/supabase-server';
import { accountMembership } from '../../lib/agency-access';
import SalesTemplateSettings from '../../components/crm/SalesTemplateSettings';
import { readTeamSettings } from '../../lib/team-settings';
import { readPendingEmailChanges } from '../../lib/account-security';
import AgencyTeamSettings from '../../components/crm/AgencyTeamSettings';

export const dynamic = 'force-dynamic';

export default async function SettingsPage(): Promise<JSX.Element> {
  const auth = await createSupabaseServerAuthClient();
  const { data: { user }, error } = await auth.auth.getUser();
  if (error || !user) redirect('/login');
  const db = getSupabaseServerClient();
  if (!db) return <SectionLayout title="Settings"><p role="alert" className="text-sm text-cui-danger">Database unavailable. Contact support.</p></SectionLayout>;
  const member = await accountMembership(db, user.id);
  if (member?.active && member.role === 'admin') {
    const team = await readTeamSettings(db, user.id).catch((failure: unknown) => {
      console.error('[settings/team]', failure);
      return null;
    });
    return <SectionLayout title="Settings"><AgencyTeamSettings initial={team} /><SalesTemplateSettings /></SectionLayout>;
  }
  if (member?.active && member.role !== 'owner') {
    const manager = await db.rpc('team_profile_manager', { p_actor: user.id });
    if (manager.error) return <SectionLayout title="Settings"><p role="alert">Team administration is unavailable.</p></SectionLayout>;
    if (manager.data === true) {
      const team = await readTeamSettings(db, user.id);
      return <SectionLayout title="Settings"><AgencyTeamSettings initial={team} /></SectionLayout>;
    }
  }
  if (!member?.active || member.role !== 'owner') return <SectionLayout title="Settings">
    <Card><CardHeader>Agency settings are owner-only</CardHeader><CardBody>
      <Link href="/account" className="text-sm font-semibold text-cui-primary underline">Open My Account</Link>
    </CardBody></Card>
  </SectionLayout>;
  const [team, requests] = await Promise.all([
    readTeamSettings(db, user.id).catch((error: unknown) => {
      console.error('[settings/team]', error);
      return null;
    }),
    readPendingEmailChanges(db).catch((error: unknown) => {
      console.error('[settings/account-email]', error);
      return null;
    }),
  ]);
  return <SectionLayout title="Settings">
    <SettingsWorkspace team={team} emailRequests={requests} />
  </SectionLayout>;
}
