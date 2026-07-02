import { NextRequest, NextResponse } from 'next/server';
import { ingestRashiDocument } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();

    const payload = await ingestRashiDocument({
      title: body.title,
      sourceType: body.type,
      sourceUrl: body.url,
      rawText: body.rawText,
      carrierName: body.carrierName,
      stateContext: body.stateContext,
      policyType: body.policyType,
      topic: body.category,
    });

    return NextResponse.json({ asset: payload }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create knowledge asset.' },
      { status: 500 },
    );
  }
}
