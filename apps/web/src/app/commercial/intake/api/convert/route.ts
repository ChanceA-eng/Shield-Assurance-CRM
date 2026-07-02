import { NextRequest, NextResponse } from 'next/server';
import { createClientFromSubmission } from '../../../../../lib/wiring/createClientFromSubmission';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const accountId = request.nextUrl.searchParams.get('id');
  if (!accountId) {
    return NextResponse.json({ message: 'id query parameter is required.' }, { status: 400 });
  }

  try {
    const result = await createClientFromSubmission(accountId, 'commercial');
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to convert commercial submission.';
    if (message.toLowerCase().includes('not found')) {
      return NextResponse.json({ message }, { status: 404 });
    }

    return NextResponse.json({ message }, { status: 500 });
  }
}
