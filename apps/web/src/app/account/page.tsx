import SectionLayout from '../../components/crm/SectionLayout';
import AccountWorkspace, { type AccountTab } from '../../components/crm/AccountWorkspace';
import { agencyEnabled } from '../../lib/agency-membership';
import { headers } from 'next/headers';
import { readStaffWorkspace, STAFF_WORKSPACE_HEADER } from '../../lib/staff-workspace';

export const dynamic = 'force-dynamic';

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }): Promise<JSX.Element> {
  const requested = (await searchParams).tab;
  const personalOnly = readStaffWorkspace((await headers()).get(STAFF_WORKSPACE_HEADER)) !== 'full';
  const tab: AccountTab = requested === 'security' || requested === 'signature' ? requested : 'profile';
  const mailboxMode = agencyEnabled() ? 'shared' : process.env.CRM_GMAIL_ENABLED === 'true' ? 'send_only' : 'disabled';
  return <SectionLayout title="My Account">
    <AccountWorkspace initialTab={tab} mailboxMode={mailboxMode} personalOnly={personalOnly} />
  </SectionLayout>;
}
