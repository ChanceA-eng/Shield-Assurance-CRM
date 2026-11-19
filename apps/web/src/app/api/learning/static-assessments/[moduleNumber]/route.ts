import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { prisma } from '../../../../../lib/prisma';
import { asInteger, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

function validModuleNumber(value: string): number | null {
  if (!/^(?:[1-9]|1[01])$/.test(value)) return null;
  return Number(value);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ moduleNumber: string }> },
): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const { moduleNumber: rawModuleNumber } = await context.params;
  const moduleNumber = validModuleNumber(rawModuleNumber);
  if (moduleNumber === null) {
    return NextResponse.json({ message: 'A valid training module number is required.' }, { status: 400 });
  }

  try {
    const attempts = await prisma.learningAssessmentAttempt.findMany({
      where: { learnerKey: session.user.id, moduleNumber },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, score: true, questionCount: true, createdAt: true },
    });
    return NextResponse.json({ attempts });
  } catch (error) {
    console.error('[learning-assessment] Failed to load practice results', error);
    return NextResponse.json({ message: 'Saved practice results could not be loaded. Refresh and retry.' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ moduleNumber: string }> },
): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const { moduleNumber: rawModuleNumber } = await context.params;
  const moduleNumber = validModuleNumber(rawModuleNumber);
  if (moduleNumber === null) {
    return NextResponse.json({ message: 'A valid training module number is required.' }, { status: 400 });
  }

  try {
    const body = await parseJsonBody(request);
    const score = asInteger(body.score);
    const questionCount = asInteger(body.questionCount);
    if (score === null || score < 0 || score > 100 || questionCount === null || questionCount < 1 || questionCount > 100) {
      return NextResponse.json({ message: 'A valid practice score and question count are required.' }, { status: 400 });
    }

    const attempt = await prisma.learningAssessmentAttempt.create({
      data: { learnerKey: session.user.id, moduleNumber, score, questionCount },
      select: { id: true, score: true, questionCount: true, createdAt: true },
    });
    return NextResponse.json({ attempt }, { status: 201 });
  } catch (error) {
    console.error('[learning-assessment] Failed to save practice result', error);
    return NextResponse.json({ message: 'Practice result could not be saved. Retry before leaving this page.' }, { status: 500 });
  }
}
