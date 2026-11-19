import { NextRequest, NextResponse } from 'next/server';
import { GET as read, POST as schedule, DELETE as cancel, type ScheduleContext } from '../../../../lib/scheduled-communication';
import { parseConversationKey } from '../../../../lib/conversations';

function context(request: NextRequest): ScheduleContext | null {
  const target = parseConversationKey(request.nextUrl.searchParams.get('conversation') ?? '');
  return target ? { params: Promise.resolve({ id: target.id, type: target.kind }) } : null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const target = context(request);
  return target ? read(request, target) : NextResponse.json({ message: 'Choose a valid conversation.' }, { status: 400 });
}
export async function POST(request: NextRequest): Promise<NextResponse> {
  const target = context(request);
  return target ? schedule(request, target) : NextResponse.json({ message: 'Choose a valid conversation.' }, { status: 400 });
}
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const target = context(request);
  return target ? cancel(request, target) : NextResponse.json({ message: 'Choose a valid conversation.' }, { status: 400 });
}
