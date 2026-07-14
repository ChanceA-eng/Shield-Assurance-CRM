import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { optionsToInputJson, optionsToJsonPayload } from '../../../../../lib/learning/quiz-options';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const id = asTrimmedString(body.id);
    if (!id) {
      return NextResponse.json({ message: 'id is required.' }, { status: 400 });
    }

    const question = asTrimmedString(body.question);
    const options = body.options === undefined ? null : optionsToJsonPayload(body.options);
    const answer = asInteger(body.answer);

    if (options && options.length > 0 && answer !== null && (answer < 0 || answer >= options.length)) {
      return NextResponse.json({ message: 'answer index is outside options range.' }, { status: 400 });
    }

    const quiz = await prisma.learningQuiz.update({
      where: { id },
      data: {
        ...(question ? { question } : {}),
        ...(options ? { options: optionsToInputJson(options) } : {}),
        ...(answer !== null ? { answer } : {}),
      },
    });

    return NextResponse.json({ quiz });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to update quiz.' },
      { status: 500 },
    );
  }
}
