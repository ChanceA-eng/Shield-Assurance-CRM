import SectionLayout from '../../../../components/crm/SectionLayout';
import RashiDocumentView from '../../../../components/rashi/rashi-document-view';

export default async function RashiDocumentPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}): Promise<JSX.Element> {
  const { documentId } = await params;

  return (
    <SectionLayout title="Rashi Document">
      <RashiDocumentView documentId={documentId} />
    </SectionLayout>
  );
}