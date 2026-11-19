import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './get/route';
import { POST } from './update/route';
import { getApiSession } from '../../../../lib/api-auth';
import { prisma } from '../../../../lib/prisma';

vi.mock('../../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../../lib/prisma', () => ({
  prisma: {
    userProgress: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

const userId = '00000000-0000-4000-8000-000000000001';
const lessonId = 'lesson-1';
const request = (url: string, body?: unknown) => new NextRequest(url, body === undefined ? undefined : {
  method: 'POST',
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: userId } as User, error: null });
});

describe('authenticated learning progress', () => {
  it('reads only the signed-in learner progress even when a client key is supplied', async () => {
    vi.mocked(prisma.userProgress.findMany).mockResolvedValue([]);
    const response = await GET(new NextRequest('http://localhost/api/learning/progress/get?learnerKey=shared-device'));
    expect(response.status).toBe(200);
    expect(prisma.userProgress.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { learnerKey: userId } }));
  });

  it('ignores client learner keys and preserves completion and best progress', async () => {
    const completedAt = new Date('2026-11-01T12:00:00Z');
    vi.mocked(prisma.userProgress.findUnique).mockResolvedValue({
      id: 'progress-1', learnerKey: userId, lessonId, completed: true, percent: 100, score: 85,
      completedAt, lastViewedAt: completedAt, createdAt: completedAt, updatedAt: completedAt,
    });
    vi.mocked(prisma.userProgress.upsert).mockResolvedValue({
      id: 'progress-1', learnerKey: userId, lessonId, completed: true, percent: 100, score: 85,
      completedAt, lastViewedAt: new Date(), createdAt: completedAt, updatedAt: new Date(),
    });

    const response = await POST(request('http://localhost/api/learning/progress/update', {
      learnerKey: 'another-agent',
      lessonId,
      completed: false,
      percent: 5,
      score: 20,
    }));

    expect(response.status).toBe(200);
    expect(prisma.userProgress.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { learnerKey_lessonId: { learnerKey: userId, lessonId } },
      create: expect.objectContaining({ learnerKey: userId, completed: true, percent: 100, score: 85, completedAt }),
      update: expect.objectContaining({ completed: true, percent: 100, score: 85, completedAt }),
    }));
  });

  it('rejects unauthenticated progress access', async () => {
    vi.mocked(getApiSession).mockResolvedValue({
      user: null,
      error: NextResponse.json({ message: 'Sign in required.' }, { status: 401 }),
    });
    const response = await GET(new NextRequest('http://localhost/api/learning/progress/get'));
    expect(response.status).toBe(401);
    expect(prisma.userProgress.findMany).not.toHaveBeenCalled();
  });
});
