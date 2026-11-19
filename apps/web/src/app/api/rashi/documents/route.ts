import { NextRequest, NextResponse } from 'next/server';
import { ingestRashiDocument, listRashiDocuments, RashiInputError } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await listRashiDocuments({
      carrierName: request.nextUrl.searchParams.get('carrierName') ?? undefined,
      stateContext: request.nextUrl.searchParams.get('stateContext') ?? undefined,
      policyType: request.nextUrl.searchParams.get('policyType') ?? undefined,
      topic: request.nextUrl.searchParams.get('topic') ?? undefined,
    });

    const safePayload = payload.map((document) => {
      const { rawText, ...rest } = document;
      return rest;
    });

    return NextResponse.json(safePayload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Rashi documents could not be loaded. Refresh the page to try again.' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const payload = await ingestRashiDocument({
      title: body.title,
      rawText: body.rawText,
      sourceType: body.sourceType,
      sourceUrl: body.sourceUrl,
      sourcePublishedAt: body.sourcePublishedAt,
      carrierName: body.carrierName,
      stateContext: body.stateContext,
      policyType: body.policyType,
      topic: body.topic,
    });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to ingest Rashi document.' },
      { status: error instanceof RashiInputError ? 400 : 500 },
    );
  }
}