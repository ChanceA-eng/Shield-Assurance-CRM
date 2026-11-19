import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { getApiSession } from '../../../../../lib/api-auth';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const progress = await prisma.userProgress.findMany({
      where: { learnerKey: session.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        lessonId: true,
        completed: true,
        percent: true,
        score: true,
        lastViewedAt: true,
      },
    });

    return NextResponse.json({ progress });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Progress could not be loaded. Refresh the page to try again.' },
      { status: 500 },
    );
  }
}
