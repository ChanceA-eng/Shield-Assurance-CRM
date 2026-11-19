import UnavailableFeature from '../../components/crm/UnavailableFeature';
export default function SecurityPage(): JSX.Element {
  return <UnavailableFeature title="User administration" description="Manage team access in Settings. Multi-factor authentication enrollment is not available here." href="/settings?tab=team" action="Open team settings" />;
}
