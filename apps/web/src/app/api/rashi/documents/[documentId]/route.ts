import { NextResponse } from 'next/server';
import { getRashiDocument } from '../../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  try {
    const { documentId } = await context.params;
    const payload = await getRashiDocument(documentId);
    const { rawText, ...safePayload } = payload;
    return NextResponse.json(safePayload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Rashi document could not be loaded. Refresh the page to try again.' },
      { status: 500 },
    );
  }
}