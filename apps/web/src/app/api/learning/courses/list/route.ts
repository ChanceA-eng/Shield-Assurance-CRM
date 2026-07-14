import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const courses = await prisma.learningCourse.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        modules: {
          orderBy: { order: 'asc' },
          include: {
            lessons: {
              orderBy: { order: 'asc' },
              include: {
                quizzes: true,
                blocks: {
                  orderBy: { order: 'asc' },
                },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({ courses });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to list courses.' },
      { status: 500 },
    );
  }
}
