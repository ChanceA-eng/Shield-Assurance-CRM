import { NextRequest, NextResponse } from 'next/server';
import { createClientFromSubmission } from '../../../lib/wiring/createClientFromSubmission';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get('id');
  const type = request.nextUrl.searchParams.get('type');

  if (!id) {
    return NextResponse.json({ message: 'id query parameter is required.' }, { status: 400 });
  }

  if (type !== 'commercial' && type !== 'personal') {
    return NextResponse.json({ message: 'type must be commercial or personal.' }, { status: 400 });
  }

  try {
    const result = await createClientFromSubmission(id, type);
    return NextResponse.json({ success: true, ...result }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to convert submission.';
    if (message.toLowerCase().includes('not found')) {
      return NextResponse.json({ message }, { status: 404 });
    }

    return NextResponse.json({ message }, { status: 500 });
  }
}
