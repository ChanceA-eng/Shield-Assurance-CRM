import { NextRequest, NextResponse } from 'next/server';
import { askRashi } from '../../../../lib/rashi-server';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';
export const maxDuration = 60;

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const message = toStringValue(body.message);
    const lessonId = toStringValue(body.lessonId);

    if (!message) {
      return NextResponse.json({ message: 'message is required.' }, { status: 400 });
    }

    if (!lessonId) {
      return NextResponse.json({ message: 'lessonId is required.' }, { status: 400 });
    }

    const lesson = await prisma.learningLesson.findUnique({
      where: { id: lessonId },
      include: {
        module: {
          include: {
            course: true,
          },
        },
      },
    });

    if (!lesson) {
      return NextResponse.json({ message: 'Lesson not found.' }, { status: 404 });
    }

    const contextualQuestion = [
      `Learning context: Course \"${lesson.module.course.title}\" -> Module \"${lesson.module.title}\" -> Lesson \"${lesson.title}\".`,
      lesson.body ? `Lesson notes: ${lesson.body}` : null,
      `Learner question: ${message}`,
    ]
      .filter((value): value is string => Boolean(value))
      .join('\n\n');

    const payload = await askRashi({
      question: contextualQuestion,
      topic: 'training',
      topK: 8,
    });

    return NextResponse.json({
      reply: payload.answer,
      citations: payload.citations,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to run learning assistant.' },
      { status: 500 },
    );
  }
}
