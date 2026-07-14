import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/prisma';
import {
  CONTRACTOR_MASTER_COURSE_TITLE,
  contractorMasterCourseBlueprint,
} from '../../../../../../lib/learning/catalog/contractor-liability-course';

export const runtime = 'nodejs';

function asInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let createdCourseId: string | null = null;

  try {
    let forceRebuild = false;
    try {
      const payload = await request.json() as { forceRebuild?: unknown };
      forceRebuild = payload.forceRebuild === true;
    } catch {
      forceRebuild = false;
    }

    const existing = await prisma.learningCourse.findFirst({
      where: { title: CONTRACTOR_MASTER_COURSE_TITLE },
      select: { id: true },
    });

    if (existing) {
      if (!forceRebuild) {
        return NextResponse.json({ courseId: existing.id, created: false });
      }

      await prisma.learningCourse.delete({ where: { id: existing.id } });
    }

    const created = await prisma.learningCourse.create({
      data: {
        title: contractorMasterCourseBlueprint.title,
        description: contractorMasterCourseBlueprint.description,
        level: contractorMasterCourseBlueprint.level,
      },
    });

    createdCourseId = created.id;

    for (let moduleIndex = 0; moduleIndex < contractorMasterCourseBlueprint.modules.length; moduleIndex += 1) {
      const moduleBlueprint = contractorMasterCourseBlueprint.modules[moduleIndex];
      const module = await prisma.learningModule.create({
        data: {
          courseId: created.id,
          title: moduleBlueprint.title,
          order: moduleIndex,
        },
      });

      for (let lessonIndex = 0; lessonIndex < moduleBlueprint.lessons.length; lessonIndex += 1) {
        const lessonBlueprint = moduleBlueprint.lessons[lessonIndex];
        const lesson = await prisma.learningLesson.create({
          data: {
            moduleId: module.id,
            title: lessonBlueprint.title,
            order: lessonIndex,
            contentType: lessonBlueprint.contentType,
            body: lessonBlueprint.body,
          },
        });

        for (let blockIndex = 0; blockIndex < lessonBlueprint.blocks.length; blockIndex += 1) {
          const block = lessonBlueprint.blocks[blockIndex];
          await prisma.learningLessonBlock.create({
            data: {
              lessonId: lesson.id,
              order: blockIndex,
              type: block.type,
              title: block.title,
              content: block.content,
            },
          });
        }

        for (let quizIndex = 0; quizIndex < lessonBlueprint.quizzes.length; quizIndex += 1) {
          const quiz = lessonBlueprint.quizzes[quizIndex];
          await prisma.learningQuiz.create({
            data: {
              lessonId: lesson.id,
              question: quiz.question,
              options: asInputJsonValue(quiz.options),
              answer: quiz.answer,
            },
          });
        }
      }
    }

    return NextResponse.json({ courseId: created.id, created: true }, { status: 201 });
  } catch (error) {
    if (createdCourseId) {
      await prisma.learningCourse.delete({ where: { id: createdCourseId } }).catch(() => {
        // Best-effort cleanup; cascade removes partial children.
      });
    }

    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to import contractor master course.' },
      { status: 500 },
    );
  }
}
