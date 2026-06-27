import { NextRequest, NextResponse } from 'next/server';
import { analyzeRashiDocument } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const action = String(body.action ?? '').toUpperCase() as 'APPETITE' | 'ELIGIBILITY' | 'EXCLUSIONS' | 'DECISION';

    if (!body.documentId) {
      return NextResponse.json({ message: 'documentId is required.' }, { status: 400 });
    }

    if (!['APPETITE', 'ELIGIBILITY', 'EXCLUSIONS', 'DECISION'].includes(action)) {
      return NextResponse.json({ message: 'Invalid action.' }, { status: 400 });
    }

    const payload = await analyzeRashiDocument(String(body.documentId), action);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to analyze Rashi document.' },
      { status: 500 },
    );
  }
}
