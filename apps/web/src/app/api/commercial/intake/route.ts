import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await prisma.commercialAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        legalName: true,
        industryGroup: true,
        riskCompletenessScore: true,
        createdAt: true,
      },
      take: 100,
    });

    return NextResponse.json(rows, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load commercial intake queue.' },
      { status: 500 },
    );
  }
}
