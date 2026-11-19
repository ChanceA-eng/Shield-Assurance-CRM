import SectionLayout from '../../../../../components/crm/SectionLayout';
import CourseOverviewWorkspace from '../../../../../components/learning/CourseOverviewWorkspace';

export default async function CourseOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;
  return <SectionLayout title="Course Overview"><CourseOverviewWorkspace courseId={id} /></SectionLayout>;
}
