import SectionLayout from '../../../components/crm/SectionLayout';
import RashiWorkspace from '../../../components/rashi/rashi-workspace';

export default function RashiKnowledgePage(): JSX.Element {
  return (
    <SectionLayout title="Rashi Knowledge Manager">
      <RashiWorkspace
        title="Rashi Knowledge Center"
        description="Manage ingestion, scoped tags, and knowledge assets for underwriting retrieval."
      />
    </SectionLayout>
  );
}
