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
    const id = asTrimmedString(body.id);
    if (!id) {
      return NextResponse.json({ message: 'id is required.' }, { status: 400 });
    }

    const title = body.title === null ? null : asTrimmedString(body.title);
    const order = asInteger(body.order);
    const type = toBlockType(asTrimmedString(body.type));

    const data: Prisma.LearningLessonBlockUpdateInput = {};
    if (body.title !== undefined) data.title = title;
    if (order !== null) data.order = order;
    if (type) data.type = type;
    if (body.content !== undefined) {
      data.content = (typeof body.content === 'object' && body.content !== null)
        ? (body.content as object)
        : Prisma.JsonNull;
    }

    const block = await prisma.learningLessonBlock.update({
      where: { id },
      data,
    });

    return NextResponse.json({ block });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update lesson block.' },
      { status: 500 },
    );
  }
}
