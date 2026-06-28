import { NextRequest, NextResponse } from 'next/server';
import { askRashi } from '../../../../lib/rashi-server';
import { prisma } from '../../../../lib/prisma';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) {
      return NextResponse.json({ message: 'message is required.' }, { status: 400 });
    }

    const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
      ? body.sessionId.trim()
      : null;

    // Upsert session and load last 12 messages from DB
    let history: Array<{ role: 'user' | 'assistant'; text: string }> = [];
    let resolvedSessionId = sessionId;

    if (resolvedSessionId) {
      const session = await prisma.chatSession.upsert({
        where: { id: resolvedSessionId },
        update: {},
        create: {
          id: resolvedSessionId,
          scope: {
            carrierName: body.carrierName ?? null,
            stateContext: body.stateContext ?? null,
            policyType: body.policyType ?? null,
          },
        },
      });
      resolvedSessionId = session.id;

      const dbMessages = await prisma.chatMessage.findMany({
        where: { sessionId: resolvedSessionId },
        orderBy: { createdAt: 'asc' },
        take: 12,
      });

      history = dbMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        text: msg.content,
      }));
    }

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

    // Persist both turns to DB for session memory
    if (resolvedSessionId) {
      await prisma.chatMessage.createMany({
        data: [
          { sessionId: resolvedSessionId, role: 'user', content: message },
          { sessionId: resolvedSessionId, role: 'assistant', content: payload.answer },
        ],
      });
    }

    return NextResponse.json(
      {
        answer: payload.answer,
        citations: payload.citations,
        sessionId: resolvedSessionId,
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
