import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({
    message: 'This email receiver has been retired. Configure the signed Resend webhook at /api/email/resend.',
  }, { status: 410 });
}
