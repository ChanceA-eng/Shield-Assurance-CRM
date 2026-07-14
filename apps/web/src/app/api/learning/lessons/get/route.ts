import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id')?.trim();
    if (!id) {
      return NextResponse.json({ message: 'id is required.' }, { status: 400 });
    }

    const lesson = await prisma.learningLesson.findUnique({
      where: { id },
      include: {
        quizzes: true,
        blocks: { orderBy: { order: 'asc' } },
        module: {
          include: {
            course: {
              include: {
                modules: {
                  orderBy: { order: 'asc' },
                  include: {
                    lessons: {
                      orderBy: { order: 'asc' },
                      select: {
                        id: true,
                        title: true,
                        moduleId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!lesson) {
      return NextResponse.json({ message: 'Lesson not found.' }, { status: 404 });
    }

    const orderedLessons = lesson.module.course.modules.flatMap((module) => module.lessons);
    const currentIndex = orderedLessons.findIndex((item) => item.id === lesson.id);
    const previousLesson = currentIndex > 0 ? orderedLessons[currentIndex - 1] : null;
    const nextLesson = currentIndex >= 0 && currentIndex < orderedLessons.length - 1
      ? orderedLessons[currentIndex + 1]
      : null;

    return NextResponse.json({
      lesson,
      navigation: {
        previousLesson,
        nextLesson,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load lesson.' },
      { status: 500 },
    );
  }
}
