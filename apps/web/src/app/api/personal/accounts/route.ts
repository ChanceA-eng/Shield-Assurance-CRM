import { NextResponse } from 'next/server';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await prisma.personalAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        primaryEmail: true,
        primaryPhone: true,
        state: true,
        zipCode: true,
        currentCarrier: true,
        currentPolicyExpiration: true,
        createdAt: true,
      },
      take: 200,
    });

    const payload = rows.map((row) => ({
      ...row,
      currentPolicyExpiration: row.currentPolicyExpiration ? row.currentPolicyExpiration.toISOString().slice(0, 10) : null,
      createdAt: row.createdAt.toISOString(),
    }));

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load personal accounts.' },
      { status: 500 },
    );
  }
}
