'use client';

import { useEffect, useMemo, useState } from 'react';

interface Course {
  id: string;
  title: string;
  description: string | null;
  level: string;
  modules: Array<{
    id: string;
    title: string;
    order: number;
    lessons: Array<{ id: string; title: string; order: number }>;
  }>;
}

interface ProgressItem {
  lessonId: string;
  completed: boolean;
  percent: number;
  lastViewedAt: string;
}

export default function CourseOverviewWorkspace({ courseId }: { courseId: string }): JSX.Element {
  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async (): Promise<void> => {
      setLoading(true);
      setError('');
      try {
        const [coursesResponse, progressResponse] = await Promise.all([
          fetch('/api/learning/courses/list'),
          fetch('/api/learning/progress/get'),
        ]);
        if (!coursesResponse.ok || !progressResponse.ok) {
          const failed = !coursesResponse.ok ? coursesResponse : progressResponse;
          const payload = (await failed.json()) as { message?: string };
          throw new Error(payload.message ?? 'Course information could not be loaded. Refresh and retry.');
        }
        const [coursesPayload, progressPayload] = await Promise.all([
          coursesResponse.json() as Promise<{ courses?: Course[] }>,
          progressResponse.json() as Promise<{ progress?: ProgressItem[] }>,
        ]);
        const selected = coursesPayload.courses?.find((item) => item.id === courseId) ?? null;
        if (!selected) throw new Error('This course could not be found. Return to the Learning Center and choose an available course.');
        if (active) {
          setCourse(selected);
          setProgress(progressPayload.progress ?? []);
        }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Course information could not be loaded. Refresh and retry.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [courseId]);

  const lessons = useMemo(() => course?.modules.flatMap((module) => module.lessons) ?? [], [course]);
  const completed = useMemo(() => new Set(progress.filter((item) => item.completed).map((item) => item.lessonId)), [progress]);
  const resumeLesson = useMemo(() => {
    const incomplete = progress
      .filter((item) => !item.completed && lessons.some((lesson) => lesson.id === item.lessonId))
      .sort((left, right) => Date.parse(right.lastViewedAt) - Date.parse(left.lastViewedAt))[0];
    return (incomplete ? lessons.find((lesson) => lesson.id === incomplete.lessonId) : null)
      ?? lessons.find((lesson) => !completed.has(lesson.id))
      ?? lessons[0]
      ?? null;
  }, [completed, lessons, progress]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {loading ? <p role="status" className="text-sm text-cui-muted">Loading course...</p> : null}
      {error ? <div role="alert" className="rounded border border-cui-danger/30 bg-cui-danger/5 p-4 text-sm text-cui-danger">{error}</div> : null}
      {!loading && course ? <>
        <header className="rounded-lg border border-cui-border bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-cui-muted">{course.level}</p>
          <h2 className="mt-2 text-2xl font-bold text-cui-text">{course.title}</h2>
          <p className="mt-3 text-sm text-cui-muted">{course.description || 'No course description has been added.'}</p>
          <p className="mt-3 text-xs text-cui-muted">{completed.size} of {lessons.length} lessons complete</p>
          {resumeLesson ? <a
            href={`/learning/lesson/${encodeURIComponent(resumeLesson.id)}?lessonId=${encodeURIComponent(resumeLesson.id)}`}
            className="mt-4 inline-flex rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white"
          >
            {completed.size === lessons.length ? 'Review course' : 'Continue'}
          </a> : <p className="mt-4 text-sm text-cui-muted">This course has no lessons yet.</p>}
        </header>
        <section className="space-y-4" aria-label="Course modules">
          {course.modules.map((module, index) => (
            <article key={module.id} className="rounded-lg border border-cui-border bg-white p-4 shadow-sm">
              <h3 className="font-semibold text-cui-text">Module {index + 1}: {module.title}</h3>
              <ul className="mt-3 divide-y divide-cui-border">
                {module.lessons.map((lesson) => (
                  <li key={lesson.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span className="text-cui-text">{lesson.title}</span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-cui-muted">{completed.has(lesson.id) ? 'Complete' : 'Not complete'}</span>
                      <a className="font-semibold text-cui-primary underline" href={`/learning/lesson/${encodeURIComponent(lesson.id)}?lessonId=${encodeURIComponent(lesson.id)}`}>Open lesson</a>
                    </span>
                  </li>
                ))}
                {!module.lessons.length ? <li className="py-3 text-sm text-cui-muted">No lessons in this module.</li> : null}
              </ul>
            </article>
          ))}
        </section>
      </> : null}
    </div>
  );
}
