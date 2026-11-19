import UnavailableFeature from '../../components/crm/UnavailableFeature';
export default function MarketplacePage(): JSX.Element {
  return <UnavailableFeature title="Integration management" description="Adding integrations is not available here. Check existing connections in Settings." href="/settings?tab=integrations" action="View connections" />;
}
