import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningCourseSnapshot } from '@prisma/client';
import { NextRequest } from 'next/server';
import { prisma } from '../../../../../lib/prisma';
import { POST } from './route';

vi.mock('../../../../../lib/prisma', () => ({
  prisma: {
    learningCourseSnapshot: { findUnique: vi.fn() },
    learningCourse: { update: vi.fn() },
    learningModule: { deleteMany: vi.fn(), create: vi.fn() },
    learningLesson: { create: vi.fn() },
    learningQuiz: { create: vi.fn() },
    learningLessonBlock: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

const request = (body: unknown) => new NextRequest('http://localhost/api/learning/snapshots/restore', {
  method: 'POST',
  body: JSON.stringify(body),
});

const snapshot = {
  id: 'snapshot-1',
  courseId: 'course-1',
  label: 'Before edits',
  payload: {
    title: 'Restored course',
    description: 'Restored description',
    level: 'BEGINNER',
    modules: [{
      title: 'Module 1',
      order: 0,
      lessons: [{
        title: 'Lesson 1',
        order: 0,
        quizzes: [{ question: 'Question', options: ['A', 'B'], answer: 0 }],
        blocks: [{ type: 'TEXT', title: 'Notes', order: 0, content: { body: 'Saved content' } }],
      }],
    }],
  },
  createdAt: new Date('2026-11-01T12:00:00Z'),
} satisfies LearningCourseSnapshot;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.learningCourseSnapshot.findUnique).mockResolvedValue(snapshot);
  vi.mocked(prisma.$transaction).mockImplementation(async (operation) => {
    if (typeof operation !== 'function') throw new Error('Expected an interactive Prisma transaction.');
    return operation(prisma);
  });
  vi.mocked(prisma.learningModule.create).mockResolvedValue({
    id: 'module-1',
    courseId: 'course-1',
    title: 'Module 1',
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(prisma.learningLesson.create).mockResolvedValue({
    id: 'lesson-1',
    moduleId: 'module-1',
    title: 'Lesson 1',
    order: 0,
    contentType: 'TEXT',
    contentUrl: null,
    body: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(prisma.learningQuiz.create).mockResolvedValue({
    id: 'quiz-1',
    lessonId: 'lesson-1',
    question: 'Question',
    options: ['A', 'B'],
    answer: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  vi.mocked(prisma.learningLessonBlock.create).mockResolvedValue({
    id: 'block-1',
    lessonId: 'lesson-1',
    order: 0,
    type: 'TEXT',
    title: 'Notes',
    content: { body: 'Saved content' },
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

describe('course snapshot restore', () => {
  it('restores nested course content inside one interactive transaction', async () => {
    const response = await POST(request({ snapshotId: 'snapshot-1' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(prisma.learningCourse.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'course-1' },
      data: expect.objectContaining({ title: 'Restored course', description: 'Restored description' }),
    }));
    expect(prisma.learningModule.deleteMany).toHaveBeenCalledWith({ where: { courseId: 'course-1' } });
    expect(prisma.learningModule.create).toHaveBeenCalledOnce();
    expect(prisma.learningLesson.create).toHaveBeenCalledOnce();
    expect(prisma.learningQuiz.create).toHaveBeenCalledOnce();
    expect(prisma.learningLessonBlock.create).toHaveBeenCalledOnce();
  });

  it('returns an explicit failure when nested restore work fails inside the transaction', async () => {
    vi.mocked(prisma.learningQuiz.create).mockRejectedValue(new Error('Quiz insert failed.'));

    const response = await POST(request({ snapshotId: 'snapshot-1' }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: 'Quiz insert failed.' });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });
});
