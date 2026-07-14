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
    const moduleId = asTrimmedString(body.moduleId);
    if (!moduleId) {
      return NextResponse.json({ message: 'moduleId is required.' }, { status: 400 });
    }

    const source = await prisma.learningModule.findUnique({
      where: { id: moduleId },
      include: {
        lessons: {
          orderBy: { order: 'asc' },
          include: {
            quizzes: true,
            blocks: { orderBy: { order: 'asc' } },
          },
        },
      },
    });

    if (!source) {
      return NextResponse.json({ message: 'Module not found.' }, { status: 404 });
    }

    const maxOrder = await prisma.learningModule.aggregate({
      where: { courseId: source.courseId },
      _max: { order: true },
    });

    const duplicated = await prisma.learningModule.create({
      data: {
        courseId: source.courseId,
        title: `${source.title} (Copy)`,
        order: (maxOrder._max.order ?? -1) + 1,
      },
    });

    for (let i = 0; i < source.lessons.length; i += 1) {
      const lesson = source.lessons[i];
      const copiedLesson = await prisma.learningLesson.create({
        data: {
          moduleId: duplicated.id,
          title: lesson.title,
          order: i,
          contentType: lesson.contentType,
          contentUrl: lesson.contentUrl,
          body: lesson.body,
        },
      });

      for (let j = 0; j < lesson.quizzes.length; j += 1) {
        const quiz = lesson.quizzes[j];
        await prisma.learningQuiz.create({
          data: {
            lessonId: copiedLesson.id,
            question: quiz.question,
            options: asInputJsonValue(quiz.options),
            answer: quiz.answer,
          },
        });
      }

      for (let k = 0; k < lesson.blocks.length; k += 1) {
        const block = lesson.blocks[k];
        await prisma.learningLessonBlock.create({
          data: {
            lessonId: copiedLesson.id,
            order: k,
            type: block.type,
            title: block.title,
            content: asNullableInputJsonValue(block.content),
          },
        });
      }
    }

    return NextResponse.json({ module: duplicated }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to duplicate module.' },
      { status: 500 },
    );
  }
}
