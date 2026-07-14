import { LearningBlockType, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

function toBlockType(raw: string | null): LearningBlockType | null {
  if (!raw) return null;
  const value = raw.toUpperCase();
  if (
    value === LearningBlockType.VIDEO
    || value === LearningBlockType.PDF
    || value === LearningBlockType.TEXT
    || value === LearningBlockType.CODE
    || value === LearningBlockType.QUIZ
    || value === LearningBlockType.EXERCISE
    || value === LearningBlockType.SIMULATION
  ) {
    return value;
  }
  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const lessonId = asTrimmedString(body.lessonId);
    const type = toBlockType(asTrimmedString(body.type));
    const title = asTrimmedString(body.title);

    if (!lessonId || !type) {
      return NextResponse.json({ message: 'lessonId and type are required.' }, { status: 400 });
    }

    const maxOrder = await prisma.learningLessonBlock.aggregate({
      where: { lessonId },
      _max: { order: true },
    });

    const block = await prisma.learningLessonBlock.create({
      data: {
        lessonId,
        type,
        title,
        order: asInteger(body.order) ?? (maxOrder._max.order ?? -1) + 1,
        content: (typeof body.content === 'object' && body.content !== null)
          ? (body.content as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });

    return NextResponse.json({ block }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create lesson block.' },
      { status: 500 },
    );
  }
}
