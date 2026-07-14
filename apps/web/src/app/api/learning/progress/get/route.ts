import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const learnerKey = searchParams.get('learnerKey')?.trim() || 'open-access';

    const progress = await prisma.userProgress.findMany({
      where: { learnerKey },
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
      { message: error instanceof Error ? error.message : 'Failed to load progress.' },
      { status: 500 },
    );
  }
}
