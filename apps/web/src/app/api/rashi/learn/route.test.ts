import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { getApiSession } from '../../../../lib/api-auth';
import { askRashi } from '../../../../lib/rashi-server';
import { prisma } from '../../../../lib/prisma';

vi.mock('../../../../lib/api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('../../../../lib/rashi-server', () => ({ askRashi: vi.fn() }));
vi.mock('../../../../lib/prisma', () => ({
  prisma: {
    learningLesson: { findUnique: vi.fn() },
  },
}));

const request = (body: unknown) => new NextRequest('http://localhost/api/rashi/learn', {
  method: 'POST',
  body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: 'learner-1' } as User, error: null });
});

describe('learning Rashi assistant', () => {
  it('requires an authenticated learner before loading lesson or calling AI', async () => {
    vi.mocked(getApiSession).mockResolvedValue({
      user: null,
      error: NextResponse.json({ message: 'Sign in required.' }, { status: 401 }),
    });

    const response = await POST(request({ message: 'Explain this', lessonId: 'lesson-1' }));

    expect(response.status).toBe(401);
    expect(prisma.learningLesson.findUnique).not.toHaveBeenCalled();
    expect(askRashi).not.toHaveBeenCalled();
  });

  it('answers with lesson context and preserves citations', async () => {
    vi.mocked(prisma.learningLesson.findUnique).mockResolvedValue({
      id: 'lesson-1',
      title: 'Risk transfer',
      body: 'A contract may shift risk.',
      module: { title: 'Contracts', course: { title: 'Commercial coverage' } },
    } as never);
    vi.mocked(askRashi).mockResolvedValue({
      question: 'Give an example.',
      answer: 'Review the contract.',
      citations: [{
        documentId: 'source-1',
        documentTitle: 'Carrier guide',
        sourceUrl: null,
        sourceType: 'GUIDELINE',
        libraryUpdatedAt: '2026-11-01T00:00:00.000Z',
        sourcePublishedAt: null,
        insightIndex: 0,
        score: 0.9,
        carrierName: 'Example Carrier',
        stateContext: 'AZ',
        policyType: 'CGL',
        topic: 'training',
      }],
    });

    const response = await POST(request({ message: 'Give an example.', lessonId: 'lesson-1' }));

    expect(response.status).toBe(200);
    expect(askRashi).toHaveBeenCalledWith(expect.objectContaining({
      topic: 'training',
      topK: 8,
      question: expect.stringContaining('Learning context: Course "Commercial coverage"'),
    }));
    expect(await response.json()).toMatchObject({
      reply: 'Review the contract.',
      citations: [{ documentTitle: 'Carrier guide', libraryUpdatedAt: '2026-11-01T00:00:00.000Z' }],
    });
  });
});
