import SectionLayout from '../../../../components/crm/SectionLayout';
import LessonPlayer from '../../../../components/learning/LessonPlayer';

export default async function LearningLessonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<JSX.Element> {
  const { id } = await params;

  return (
    <SectionLayout title="Learning Lesson">
      <LessonPlayer lessonId={id} />
    </SectionLayout>
  );
}
