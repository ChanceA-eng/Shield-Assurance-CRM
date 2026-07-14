import { LearningContentType, LearningLevel, LearningBlockType, Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { asTrimmedString, parseJsonBody } from '../../_shared';

export const runtime = 'nodejs';

type SnapshotPayload = {
  title?: string;
  description?: string | null;
  level?: LearningLevel;
  modules?: Array<{
    title?: string;
    order?: number;
    lessons?: Array<{
      title?: string;
      order?: number;
      contentType?: LearningContentType;
      contentUrl?: string | null;
      body?: string | null;
      quizzes?: Array<{
        question?: string;
        options?: unknown;
        answer?: number;
      }>;
      blocks?: Array<{
        type?: LearningBlockType;
        title?: string | null;
        order?: number;
        content?: unknown;
      }>;
    }>;
  }>;
};

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await parseJsonBody(request);
    const snapshotId = asTrimmedString(body.snapshotId);
    if (!snapshotId) {
      return NextResponse.json({ message: 'snapshotId is required.' }, { status: 400 });
    }

    const snapshot = await prisma.learningCourseSnapshot.findUnique({ where: { id: snapshotId } });
    if (!snapshot) {
      return NextResponse.json({ message: 'Snapshot not found.' }, { status: 404 });
    }

    const payload = (snapshot.payload ?? {}) as SnapshotPayload;
    const modules = Array.isArray(payload.modules) ? payload.modules : [];

    await prisma.learningCourse.update({
      where: { id: snapshot.courseId },
      data: {
        title: safeString(payload.title) || undefined,
        description: payload.description === undefined ? undefined : payload.description,
        level: payload.level,
      },
    });

    await prisma.learningModule.deleteMany({ where: { courseId: snapshot.courseId } });

    for (let i = 0; i < modules.length; i += 1) {
      const modulePayload = modules[i];
      const createdModule = await prisma.learningModule.create({
        data: {
          courseId: snapshot.courseId,
          title: safeString(modulePayload.title) || `Module ${i + 1}`,
          order: typeof modulePayload.order === 'number' ? modulePayload.order : i,
        },
      });

      const lessons = Array.isArray(modulePayload.lessons) ? modulePayload.lessons : [];
      for (let j = 0; j < lessons.length; j += 1) {
        const lessonPayload = lessons[j];
        const createdLesson = await prisma.learningLesson.create({
          data: {
            moduleId: createdModule.id,
            title: safeString(lessonPayload.title) || `Lesson ${j + 1}`,
            order: typeof lessonPayload.order === 'number' ? lessonPayload.order : j,
            contentType: lessonPayload.contentType ?? LearningContentType.TEXT,
            contentUrl: lessonPayload.contentUrl ?? null,
            body: lessonPayload.body ?? null,
          },
        });

        const quizzes = Array.isArray(lessonPayload.quizzes) ? lessonPayload.quizzes : [];
        for (let q = 0; q < quizzes.length; q += 1) {
          const quiz = quizzes[q];
          await prisma.learningQuiz.create({
            data: {
              lessonId: createdLesson.id,
              question: safeString(quiz.question) || `Question ${q + 1}`,
              options: (quiz.options as Prisma.InputJsonValue) ?? [],
              answer: typeof quiz.answer === 'number' ? quiz.answer : 0,
            },
          });
        }

        const blocks = Array.isArray(lessonPayload.blocks) ? lessonPayload.blocks : [];
        for (let b = 0; b < blocks.length; b += 1) {
          const block = blocks[b];
          await prisma.learningLessonBlock.create({
            data: {
              lessonId: createdLesson.id,
              type: block.type ?? LearningBlockType.TEXT,
              title: block.title ?? null,
              order: typeof block.order === 'number' ? block.order : b,
              content: (block.content as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            },
          });
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to restore snapshot.' },
      { status: 500 },
    );
  }
}
