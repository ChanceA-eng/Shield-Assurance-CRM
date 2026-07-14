import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asInteger, asTrimmedString, coercePercent, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const learnerKey = asTrimmedString(body.learnerKey) ?? 'open-access';
    const lessonId = asTrimmedString(body.lessonId);
    const completed = body.completed === true;
    const percent = coercePercent(body.percent);
    const score = asInteger(body.score);

    if (!lessonId) {
      return NextResponse.json({ message: 'lessonId is required.' }, { status: 400 });
    }

    const progress = await prisma.userProgress.upsert({
      where: {
        learnerKey_lessonId: {
          learnerKey,
          lessonId,
        },
      },
      create: {
        learnerKey,
        lessonId,
        completed,
        percent,
        score,
        completedAt: completed ? new Date() : null,
      },
      update: {
        completed,
        percent,
        score,
        completedAt: completed ? new Date() : null,
        lastViewedAt: new Date(),
      },
    });

    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update progress.' },
      { status: 500 },
    );
  }
}
