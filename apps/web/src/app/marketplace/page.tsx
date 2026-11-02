import UnavailableFeature from '../../components/crm/UnavailableFeature';
export default function MarketplacePage(): JSX.Element {
  return <UnavailableFeature title="Integration management" description="There is no integration installer here. Providers are configured through environment settings; missing configuration must not be mistaken for a connected provider." href="/settings" action="View release & setup" />;
}
