import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const courseId = asTrimmedString(body.courseId);
    const title = asTrimmedString(body.title);

    if (!courseId || !title) {
      return NextResponse.json({ message: 'courseId and title are required.' }, { status: 400 });
    }

    const maxOrder = await prisma.learningModule.aggregate({
      where: { courseId },
      _max: { order: true },
    });

    const module = await prisma.learningModule.create({
      data: {
        courseId,
        title,
        order: asInteger(body.order) ?? (maxOrder._max.order ?? -1) + 1,
      },
    });

    return NextResponse.json({ module }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create module.' },
      { status: 500 },
    );
  }
}
