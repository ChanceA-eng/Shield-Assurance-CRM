import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

function asInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return (value === null ? Prisma.JsonNull : value) as Prisma.InputJsonValue;
}

function asNullableInputJsonValue(value: Prisma.JsonValue): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return (value === null ? Prisma.JsonNull : value) as Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const lessonId = asTrimmedString(body.lessonId);
    if (!lessonId) {
      return NextResponse.json({ message: 'lessonId is required.' }, { status: 400 });
    }

    const source = await prisma.learningLesson.findUnique({
      where: { id: lessonId },
      include: {
        quizzes: true,
        blocks: { orderBy: { order: 'asc' } },
      },
    });

    if (!source) {
      return NextResponse.json({ message: 'Lesson not found.' }, { status: 404 });
    }

    const maxOrder = await prisma.learningLesson.aggregate({
      where: { moduleId: source.moduleId },
      _max: { order: true },
    });

    const duplicated = await prisma.learningLesson.create({
      data: {
        moduleId: source.moduleId,
        title: `${source.title} (Copy)`,
        order: (maxOrder._max.order ?? -1) + 1,
        contentType: source.contentType,
        contentUrl: source.contentUrl,
        body: source.body,
      },
    });

    for (let i = 0; i < source.quizzes.length; i += 1) {
      const quiz = source.quizzes[i];
      await prisma.learningQuiz.create({
        data: {
          lessonId: duplicated.id,
          question: quiz.question,
          options: asInputJsonValue(quiz.options),
          answer: quiz.answer,
        },
      });
    }

    for (let i = 0; i < source.blocks.length; i += 1) {
      const block = source.blocks[i];
      await prisma.learningLessonBlock.create({
        data: {
          lessonId: duplicated.id,
          order: i,
          type: block.type,
          title: block.title,
          content: asNullableInputJsonValue(block.content),
        },
      });
    }

    return NextResponse.json({ lesson: duplicated }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to duplicate lesson.' },
      { status: 500 },
    );
  }
}
