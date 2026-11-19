import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { getApiSession } from '../../../../../lib/api-auth';
import { asInteger, asTrimmedString, coercePercent, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const body = await parseJsonBody(request);
    const learnerKey = session.user.id;
    const lessonId = asTrimmedString(body.lessonId);
    const existing = lessonId
      ? await prisma.userProgress.findUnique({ where: { learnerKey_lessonId: { learnerKey, lessonId } } })
      : null;
    const completed = body.completed === true || existing?.completed === true;
    const percent = Math.max(existing?.percent ?? 0, coercePercent(body.percent));
    const suppliedScore = asInteger(body.score);
    const score = suppliedScore === null
      ? existing?.score ?? null
      : Math.max(existing?.score ?? 0, Math.max(0, Math.min(100, suppliedScore)));

    if (!lessonId) {
      return NextResponse.json({ message: 'lessonId is required.' }, { status: 400 });
    }
    const now = new Date();
    const completedAt = existing?.completedAt ?? (completed ? now : null);

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
        completedAt,
      },
      update: {
        completed,
        percent,
        score,
        completedAt,
        lastViewedAt: now,
      },
    });

    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Progress could not be updated. Please try again.' },
      { status: 500 },
    );
  }
}
