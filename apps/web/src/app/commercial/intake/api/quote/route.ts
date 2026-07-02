import { NextRequest, NextResponse } from 'next/server';
import { generateQuoteFromIntake, listQuotesForAccount } from '../../quoteWorkflow';
import { prisma } from '../../../../../lib/prisma';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accountId = request.nextUrl.searchParams.get('id');

  if (!accountId) {
    return NextResponse.json({ message: 'id query parameter is required.' }, { status: 400 });
  }

  try {
    const result = await generateQuoteFromIntake(accountId);
    const quoteHistory = await listQuotesForAccount(accountId);
    const account = await prisma.commercialAccount.findUnique({
      where: { id: accountId },
      select: { convertedClientId: true },
    });

    return NextResponse.json({
      ...result,
      quoteHistory,
      convertedClientId: account?.convertedClientId ?? null,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Account not found') {
      return NextResponse.json({ message: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to generate quote.' },
      { status: 500 },
    );
  }
}
