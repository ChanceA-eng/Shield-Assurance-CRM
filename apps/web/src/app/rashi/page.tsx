import SectionLayout from '../../components/crm/SectionLayout';
import RashiKnowledgeCenter from '../../components/rashi/rashi-knowledge-center';

export default function RashiHomePage(): JSX.Element {
  return (
    <SectionLayout title="Knowledge Center">
      <RashiKnowledgeCenter />
    </SectionLayout>
  );
}