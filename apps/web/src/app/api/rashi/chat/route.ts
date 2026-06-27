import { NextRequest, NextResponse } from 'next/server';
import { askRashi } from '../../../../lib/rashi-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { role?: unknown; text?: unknown };
  return (
    (candidate.role === 'user' || candidate.role === 'assistant')
    && typeof candidate.text === 'string'
    && candidate.text.trim().length > 0
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';

    if (!message) {
      return NextResponse.json({ message: 'message is required.' }, { status: 400 });
    }

    const historyInput: unknown[] = Array.isArray(body.history) ? body.history : [];
    const history = historyInput
      .filter((entry: unknown): entry is ChatMessage => isChatMessage(entry))
      .slice(-16);

    const payload = await askRashi({
      question: message,
      history,
      documentId: body.documentId,
      carrierName: body.carrierName,
      stateContext: body.stateContext,
      policyType: body.policyType,
      topic: body.topic,
      topK: body.topK,
    });

    return NextResponse.json(
      {
        answer: payload.answer,
        citations: payload.citations,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to chat with Rashi.' },
      { status: 500 },
    );
  }
}
