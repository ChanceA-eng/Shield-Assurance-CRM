import { LearningLevel } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

function toLearningLevel(raw: string | null): LearningLevel {
  if (!raw) {
    return LearningLevel.BEGINNER;
  }

  const value = raw.toUpperCase();
  if (value === LearningLevel.BEGINNER || value === LearningLevel.INTERMEDIATE || value === LearningLevel.ADVANCED) {
    return value;
  }

  return LearningLevel.BEGINNER;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const title = asTrimmedString(body.title);
    if (!title) {
      return NextResponse.json({ message: 'title is required.' }, { status: 400 });
    }

    const description = asTrimmedString(body.description);
    const level = toLearningLevel(asTrimmedString(body.level));

    const course = await prisma.learningCourse.create({
      data: {
        title,
        description,
        level,
      },
    });

    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create course.' },
      { status: 500 },
    );
  }
}
