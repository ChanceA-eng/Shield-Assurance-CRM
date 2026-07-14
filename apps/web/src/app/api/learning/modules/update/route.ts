import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const id = asTrimmedString(body.id);
    if (!id) {
      return NextResponse.json({ message: 'id is required.' }, { status: 400 });
    }

    const title = asTrimmedString(body.title);
    const order = asInteger(body.order);

    const data: Prisma.LearningModuleUpdateInput = {};
    if (title) {
      data.title = title;
    }
    if (order !== null) {
      data.order = order;
    }

    const module = await prisma.learningModule.update({
      where: { id },
      data,
    });

    return NextResponse.json({ module });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update module.' },
      { status: 500 },
    );
  }
}
