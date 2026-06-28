import { NextResponse } from 'next/server';
import { getRashiDocument } from '../../../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  try {
    const { documentId } = await context.params;
    const document = await getRashiDocument(documentId);

    if (!document.sourceUrl) {
      return NextResponse.json({ message: 'This document does not have a source asset URL.' }, { status: 404 });
    }

    const targetUrl = new URL(document.sourceUrl, request.url);
    return NextResponse.redirect(targetUrl, 307);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to open source document.' },
      { status: 500 },
    );
  }
}