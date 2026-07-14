import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { normalizeQuizOptions } from '../../../../../lib/learning/quiz-options';
import { asInteger, asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const quizId = asTrimmedString(body.quizId);
    const selected = asInteger(body.selected);

    if (!quizId || selected === null) {
      return NextResponse.json({ message: 'quizId and selected are required.' }, { status: 400 });
    }

    const quiz = await prisma.learningQuiz.findUnique({ where: { id: quizId } });
    if (!quiz) {
      return NextResponse.json({ message: 'Quiz not found.' }, { status: 404 });
    }

    const correct = quiz.answer === selected;
    const options = normalizeQuizOptions(quiz.options);
    const selectedOption = options[selected];
    const correctOption = options[quiz.answer];

    return NextResponse.json({
      correct,
      answer: quiz.answer,
      selectedText: selectedOption?.text ?? null,
      selectedExplanation: selectedOption?.explanation ?? null,
      correctText: correctOption?.text ?? null,
      correctExplanation: correctOption?.explanation ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to submit quiz.' },
      { status: 500 },
    );
  }
}
