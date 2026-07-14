import { LearningContentType, Prisma } from '@prisma/client';
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
    const id = asTrimmedString(body.id);
    if (!id) {
      return NextResponse.json({ message: 'id is required.' }, { status: 400 });
    }

    const title = asTrimmedString(body.title);
    const order = asInteger(body.order);
    const contentType = toContentType(asTrimmedString(body.contentType));
    const contentUrl = body.contentUrl === null ? null : asTrimmedString(body.contentUrl);
    const lessonBody = body.body === null ? null : asTrimmedString(body.body);

    const data: Prisma.LearningLessonUpdateInput = {};
    if (title) {
      data.title = title;
    }
    if (order !== null) {
      data.order = order;
    }
    if (contentType) {
      data.contentType = contentType;
    }
    if (body.contentUrl !== undefined) {
      data.contentUrl = contentUrl;
    }
    if (body.body !== undefined) {
      data.body = lessonBody;
    }

    const lesson = await prisma.learningLesson.update({
      where: { id },
      data,
    });

    return NextResponse.json({ lesson });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update lesson.' },
      { status: 500 },
    );
  }
}
