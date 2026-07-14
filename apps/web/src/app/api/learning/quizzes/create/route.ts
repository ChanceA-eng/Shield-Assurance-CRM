import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { optionsToInputJson, optionsToJsonPayload } from '../../../../../lib/learning/quiz-options';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const lessonId = asTrimmedString(body.lessonId);
    const question = asTrimmedString(body.question);
    const options = optionsToJsonPayload(body.options);
    const answer = asInteger(body.answer);

    if (!lessonId || !question || options.length < 2 || answer === null || answer < 0 || answer >= options.length) {
      return NextResponse.json({ message: 'Invalid quiz payload.' }, { status: 400 });
    }

    const quiz = await prisma.learningQuiz.create({
      data: {
        lessonId,
        question,
        options: optionsToInputJson(options),
        answer,
      },
    });

    return NextResponse.json({ quiz }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create quiz.' },
      { status: 500 },
    );
  }
}
