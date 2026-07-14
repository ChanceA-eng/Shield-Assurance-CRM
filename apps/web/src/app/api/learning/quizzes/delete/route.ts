import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const id = asTrimmedString(body.id);
    if (!id) {
      return NextResponse.json({ message: 'id is required.' }, { status: 400 });
    }

    await prisma.learningQuiz.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to delete quiz.' },
      { status: 500 },
    );
  }
}
