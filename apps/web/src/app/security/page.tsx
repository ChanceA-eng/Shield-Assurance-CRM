import UnavailableFeature from '../../components/crm/UnavailableFeature';
export default function SecurityPage(): JSX.Element {
  return <UnavailableFeature title="User administration" description="Role editing and MFA enrollment are not available from this page. Existing sign-in remains protected by Supabase authentication." href="/settings" action="View release & setup" />;
}
