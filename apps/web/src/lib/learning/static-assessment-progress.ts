'use client';

import { useCallback, useEffect, useState } from 'react';

export interface StaticAssessmentAttempt {
  id: string;
  score: number;
  questionCount: number;
  createdAt: string;
}

interface AssessmentResponse {
  attempts?: StaticAssessmentAttempt[];
  attempt?: StaticAssessmentAttempt;
  message?: string;
}

export function useStaticAssessmentProgress(moduleNumber: number): {
  attempts: StaticAssessmentAttempt[];
  loading: boolean;
  saving: boolean;
  error: string | null;
  saveAttempt: (score: number, questionCount: number) => Promise<void>;
} {
  const [attempts, setAttempts] = useState<StaticAssessmentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch(`/api/learning/static-assessments/${moduleNumber}`)
      .then(async (response) => {
        const payload = (await response.json()) as AssessmentResponse;
        if (!response.ok) throw new Error(payload.message ?? 'Saved practice results could not be loaded.');
        if (active) setAttempts(payload.attempts ?? []);
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : 'Saved practice results could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [moduleNumber]);

  const saveAttempt = useCallback(async (score: number, questionCount: number): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/learning/static-assessments/${moduleNumber}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, questionCount }),
      });
      const payload = (await response.json()) as AssessmentResponse;
      if (!response.ok || !payload.attempt) {
        throw new Error(payload.message ?? 'Practice result could not be saved. Retry.');
      }
      setAttempts((current) => [payload.attempt!, ...current].slice(0, 10));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Practice result could not be saved. Retry.');
    } finally {
      setSaving(false);
    }
  }, [moduleNumber]);

  return { attempts, loading, saving, error, saveAttempt };
}
