import { NextResponse } from 'next/server';
import { reingestRashiDocument } from '../../../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  try {
    const { documentId } = await context.params;
    const payload = await reingestRashiDocument(documentId);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to re-ingest Rashi document.' },
      { status: 500 },
    );
  }
}
