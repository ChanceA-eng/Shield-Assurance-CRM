import { NextRequest, NextResponse } from 'next/server';
import { getRashiStats } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = await getRashiStats({
      carrierName: request.nextUrl.searchParams.get('carrierName') ?? undefined,
      stateContext: request.nextUrl.searchParams.get('stateContext') ?? undefined,
      policyType: request.nextUrl.searchParams.get('policyType') ?? undefined,
      topic: request.nextUrl.searchParams.get('topic') ?? undefined,
    });
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to load Rashi stats.' },
      { status: 500 },
    );
  }
}