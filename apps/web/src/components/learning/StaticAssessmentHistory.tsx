'use client';

import type { StaticAssessmentAttempt } from '../../lib/learning/static-assessment-progress';

interface StaticAssessmentHistoryProps {
  attempts: StaticAssessmentAttempt[];
  loading: boolean;
  error: string | null;
}

export default function StaticAssessmentHistory({ attempts, loading, error }: StaticAssessmentHistoryProps): JSX.Element {
  const latest = attempts[0];
  return (
    <div className="space-y-2" aria-live="polite">
      {loading ? <p className="text-sm text-slate-600">Loading saved practice results...</p> : null}
      {latest ? (
        <p role="status" className="text-sm text-slate-700">
          Latest saved practice result: {latest.score}% ({latest.questionCount} questions)
          {' · '}{new Date(latest.createdAt).toLocaleDateString()}
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm font-semibold text-red-700">{error}</p> : null}
    </div>
  );
}
