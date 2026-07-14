import { LearningContentType } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

function toContentType(raw: string | null): LearningContentType | null {
  if (!raw) {
    return null;
  }

  const value = raw.toUpperCase();
  if (
    value === LearningContentType.TEXT
    || value === LearningContentType.PDF
    || value === LearningContentType.VIDEO
    || value === LearningContentType.INTERACTIVE
  ) {
    return value;
  }

  return null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const moduleId = asTrimmedString(body.moduleId);
    const title = asTrimmedString(body.title);
    const contentType = toContentType(asTrimmedString(body.contentType)) ?? LearningContentType.TEXT;

    if (!moduleId || !title) {
      return NextResponse.json({ message: 'moduleId and title are required.' }, { status: 400 });
    }

    const maxOrder = await prisma.learningLesson.aggregate({
      where: { moduleId },
      _max: { order: true },
    });

    const lesson = await prisma.learningLesson.create({
      data: {
        moduleId,
        title,
        order: asInteger(body.order) ?? (maxOrder._max.order ?? -1) + 1,
        contentType,
        contentUrl: asTrimmedString(body.contentUrl),
        body: asTrimmedString(body.body),
      },
    });

    return NextResponse.json({ lesson }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create lesson.' },
      { status: 500 },
    );
  }
}
