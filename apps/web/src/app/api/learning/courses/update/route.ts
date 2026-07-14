import { LearningLevel, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

function toLearningLevel(raw: string | null): LearningLevel | null {
  if (!raw) {
    return null;
  }

  const value = raw.toUpperCase();
  if (value === LearningLevel.BEGINNER || value === LearningLevel.INTERMEDIATE || value === LearningLevel.ADVANCED) {
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
    const description = body.description === null ? null : asTrimmedString(body.description);
    const level = toLearningLevel(asTrimmedString(body.level));

    const data: Prisma.LearningCourseUpdateInput = {};
    if (title) {
      data.title = title;
    }
    if (body.description !== undefined) {
      data.description = description;
    }
    if (level) {
      data.level = level;
    }

    const course = await prisma.learningCourse.update({
      where: { id },
      data,
    });

    return NextResponse.json({ course });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update course.' },
      { status: 500 },
    );
  }
}
