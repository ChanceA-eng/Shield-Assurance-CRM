import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../lib/api-auth';
import { prisma } from '../../../../../lib/prisma';
import { GET, POST } from './route';

vi.mock('../../../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../../../lib/prisma', () => ({
  prisma: {
    learningAssessmentAttempt: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

const userId = '00000000-0000-4000-8000-000000000001';
const context = (moduleNumber: string) => ({ params: Promise.resolve({ moduleNumber }) });
const postRequest = (body: unknown) => new NextRequest('http://localhost/api/learning/static-assessments/3', {
  method: 'POST',
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: userId } as User, error: null });
});

describe('static learning assessment history', () => {
  it('returns only the authenticated learner assessment attempts for a valid module', async () => {
    vi.mocked(prisma.learningAssessmentAttempt.findMany).mockResolvedValue([]);
    const response = await GET(
      new NextRequest('http://localhost/api/learning/static-assessments/3'),
      context('3'),
    );
    expect(response.status).toBe(200);
    expect(prisma.learningAssessmentAttempt.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { learnerKey: userId, moduleNumber: 3 },
      take: 10,
    }));
  });

  it('saves a bounded practice result under the signed-in learner identity', async () => {
    const attempt = {
      id: 'attempt-1',
      learnerKey: userId,
      moduleNumber: 3,
      score: 80,
      questionCount: 10,
      createdAt: new Date(),
    };
    vi.mocked(prisma.learningAssessmentAttempt.create).mockResolvedValue(attempt);
    const response = await POST(postRequest({ learnerKey: 'other-user', score: 80, questionCount: 10 }), context('3'));
    expect(response.status).toBe(201);
    expect(prisma.learningAssessmentAttempt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { learnerKey: userId, moduleNumber: 3, score: 80, questionCount: 10 },
    }));
  });

  it('rejects invalid module numbers and score data before writing', async () => {
    const invalidModule = await POST(postRequest({ score: 80, questionCount: 10 }), context('12'));
    const invalidScore = await POST(postRequest({ score: 101, questionCount: 10 }), context('3'));
    expect(invalidModule.status).toBe(400);
    expect(invalidScore.status).toBe(400);
    expect(prisma.learningAssessmentAttempt.create).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated result reads and writes', async () => {
    vi.mocked(getApiSession).mockResolvedValue({
      user: null,
      error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }),
    });
    const read = await GET(new NextRequest('http://localhost/api/learning/static-assessments/3'), context('3'));
    const write = await POST(postRequest({ score: 80, questionCount: 10 }), context('3'));
    expect(read.status).toBe(401);
    expect(write.status).toBe(401);
    expect(prisma.learningAssessmentAttempt.findMany).not.toHaveBeenCalled();
    expect(prisma.learningAssessmentAttempt.create).not.toHaveBeenCalled();
  });
});
