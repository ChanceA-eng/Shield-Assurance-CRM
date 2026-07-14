import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const courseId = asTrimmedString(body.courseId);
    const label = asTrimmedString(body.label) ?? `Snapshot ${new Date().toISOString()}`;

    if (!courseId) {
      return NextResponse.json({ message: 'courseId is required.' }, { status: 400 });
    }

    const course = await prisma.learningCourse.findUnique({
      where: { id: courseId },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              include: {
                quizzes: true,
                blocks: { orderBy: { order: 'asc' } },
              },
            },
          },
        },
      },
    });

    if (!course) {
      return NextResponse.json({ message: 'Course not found.' }, { status: 404 });
    }

    const snapshot = await prisma.learningCourseSnapshot.create({
      data: {
        courseId,
        label,
        payload: {
          title: course.title,
          description: course.description,
          level: course.level,
          modules: course.modules.map((module) => ({
            title: module.title,
            order: module.order,
            lessons: module.lessons.map((lesson) => ({
              title: lesson.title,
              order: lesson.order,
              contentType: lesson.contentType,
              contentUrl: lesson.contentUrl,
              body: lesson.body,
              quizzes: lesson.quizzes.map((quiz) => ({
                question: quiz.question,
                options: quiz.options,
                answer: quiz.answer,
              })),
              blocks: lesson.blocks.map((block) => ({
                type: block.type,
                title: block.title,
                order: block.order,
                content: block.content,
              })),
            })),
          })),
        },
      },
    });

    return NextResponse.json({ snapshot }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create snapshot.' },
      { status: 500 },
    );
  }
}
