import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId')?.trim();

    if (!courseId) {
      return NextResponse.json({ message: 'courseId is required.' }, { status: 400 });
    }

    const snapshots = await prisma.learningCourseSnapshot.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        label: true,
        createdAt: true,
      },
      take: 25,
    });

    return NextResponse.json({ snapshots });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to list snapshots.' },
      { status: 500 },
    );
  }
}
