import { NextRequest, NextResponse } from 'next/server';
import { sendEmail } from '../../../../lib/messaging';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const payload = (await request.json()) as { to?: string; subject?: string; body?: string };

  if (!payload.to) {
    return NextResponse.json({ message: 'to is required.' }, { status: 400 });
  }

  const subject = payload.subject?.trim() || 'Shield CRM test email';
  const body = payload.body?.trim() || 'This is a test email from Shield CRM automation.';

  try {
    await sendEmail({ to: payload.to, subject, body });
    return NextResponse.json({ ok: true, to: payload.to, subject }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown email test failure';
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
