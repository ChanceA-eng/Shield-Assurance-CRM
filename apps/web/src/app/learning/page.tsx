'use client';
import { useEffect, useMemo, useState } from 'react';
import SectionLayout from '../../components/crm/SectionLayout';
import { CONTRACTOR_MASTER_COURSE_TITLE } from '../../lib/learning/catalog/contractor-liability-course';

interface ProgressItem {
  lessonId: string;
  completed: boolean;
}

interface CourseListItem {
  id: string;
  title: string;
  description: string | null;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  modules: Array<{
    id: string;
    title: string;
    order?: number;
    lessons: Array<{ id: string; title: string }>;
  }>;
}

const DEFAULT_LEARNER_KEY = 'open-access';

function learnerKey(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_LEARNER_KEY;
  }

  const key = 'learning_learner_key';
  return window.localStorage.getItem(key) ?? DEFAULT_LEARNER_KEY;
}

export default function LearningCenterPage(): JSX.Element {
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      setLoading(true);
      const [coursesRes, progressRes] = await Promise.all([
        fetch('/api/learning/courses/list'),
        fetch(`/api/learning/progress/get?learnerKey=${encodeURIComponent(learnerKey())}`),
      ]);

      const coursesPayload = (await coursesRes.json()) as { courses?: CourseListItem[] };
      const progressPayload = (await progressRes.json()) as { progress?: ProgressItem[] };

      setCourses(coursesPayload.courses ?? []);
      setProgress(progressPayload.progress ?? []);
      setLoading(false);
    }

    void load();
  }, []);

  async function startFlagshipCourse(): Promise<void> {
    setInstalling(true);
    setStartError(null);

    try {
      const importResponse = await fetch('/api/learning/courses/import/contractor-liability-master', {
        method: 'POST',
      });
      if (!importResponse.ok) {
        const payload = (await importResponse.json()) as { message?: string };
        throw new Error(payload.message ?? 'Unable to start course import right now.');
      }

      const importPayload = (await importResponse.json()) as { courseId?: string };

      const coursesRes = await fetch('/api/learning/courses/list');
      if (!coursesRes.ok) {
        const payload = (await coursesRes.json()) as { message?: string };
        throw new Error(payload.message ?? 'Unable to load courses after import.');
      }

      const coursesPayload = (await coursesRes.json()) as { courses?: CourseListItem[] };
      const latestCourses = coursesPayload.courses ?? [];
      setCourses(latestCourses);

      const importedCourse = latestCourses.find((course) => course.id === importPayload.courseId || course.title === CONTRACTOR_MASTER_COURSE_TITLE);
      if (importedCourse) {
        window.location.href = `/learning/course/${importedCourse.id}/overview`;
        return;
      }

      window.location.href = '/learning/course-builder';
    } catch (error) {
      setStartError(error instanceof Error ? error.message : 'Unable to start the course right now.');
    } finally {
      setInstalling(false);
    }
  }

  const completedByLesson = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const item of progress) {
      map.set(item.lessonId, item.completed);
    }
    return map;
  }, [progress]);

  const cards = useMemo(() => {
    return courses.map((course) => {
      const lessons = course.modules.flatMap((module) => module.lessons);
      const total = lessons.length;
      const completed = lessons.filter((lesson) => completedByLesson.get(lesson.id) === true).length;
      const resumeLesson = lessons.find((lesson) => completedByLesson.get(lesson.id) !== true) ?? lessons[0] ?? null;

      return {
        id: course.id,
        title: course.title,
        description: course.description,
        level: course.level,
        modulesCount: course.modules.length,
        totalLessons: total,
        completedLessons: completed,
        completionPercent: total > 0 ? Math.round((completed / total) * 100) : 0,
        resumeLessonId: resumeLesson?.id ?? null,
      };
    });
  }, [courses, completedByLesson]);

  const flagshipCourse = useMemo(
    () => cards.find((course) => course.title === CONTRACTOR_MASTER_COURSE_TITLE) ?? null,
    [cards],
  );

  return (
    <SectionLayout title="Learning Center">
      <div className="space-y-4">
        <div className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-[#23282c]">Interactive Learning Platform</h2>
              <p className="text-sm text-[#514f4d]">Courses, modules, quizzes, simulations, and Rashi coaching are now wired as a foundation layer.</p>
            </div>
            <a href="/learning/course-builder" className="rounded-md bg-[#23282c] px-3 py-2 text-xs font-semibold text-white hover:bg-[#133a6b]">
              Open Learning Studio
            </a>
          </div>
        </div>

        <div className="rounded-lg border border-[#cfd8e6] bg-[#f4f8ff] p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#2f4f77]">Flagship Course</p>
              <h3 className="mt-1 text-base font-bold text-[#102a43]">Contractor Liability and Risk Master Course</h3>
              <p className="mt-1 text-xs text-[#2f4f77]">Modules 1-4 are pre-built with legal mechanics, CGL strategy, E&O timing, workers comp operations, and explanation-driven knowledge checks.</p>
            </div>

            {flagshipCourse ? (
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/learning/course/${flagshipCourse.id}/overview`}
                  className="rounded-md bg-[#167495] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0c4e8a]"
                >
                  Start Learning
                </a>
                <a href={`/learning/course-builder/${flagshipCourse.id}`} className="rounded-md border border-[#167495] px-3 py-2 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff]">
                  Open in Studio
                </a>
              </div>
            ) : (
              <button
                type="button"
                disabled={installing}
                onClick={() => {
                  void startFlagshipCourse();
                }}
                className="rounded-md bg-[#167495] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0c4e8a] disabled:opacity-60"
              >
                {installing ? 'Starting...' : 'Start Course'}
              </button>
            )}
          </div>
          {startError ? (
            <p className="mt-2 text-xs font-semibold text-[#a61b1b]">{startError}</p>
          ) : null}
        </div>

        {loading ? <p className="text-sm text-[#514f4d]">Loading learning dashboard...</p> : null}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {cards.map((course) => (
            <article key={course.id} className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#706e6b]">{course.level}</p>
              <h3 className="mt-1 text-base font-bold text-[#23282c]">{course.title}</h3>
              <p className="mt-1 text-xs text-[#514f4d]">{course.description ?? 'No description yet. Add one in Course Builder.'}</p>

              <div className="mt-3 flex items-center justify-between text-xs text-[#514f4d]">
                <span>{course.modulesCount} modules</span>
                <span>{course.completedLessons}/{course.totalLessons} lessons complete</span>
              </div>

              <div className="mt-2 h-2 w-full rounded-full bg-[#e4e5e6]">
                <div className="h-2 rounded-full bg-[#167495]" style={{ width: `${course.completionPercent}%` }} />
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <a href={`/learning/course-builder/${course.id}`} className="rounded-md border border-[#c8ced3] px-2.5 py-1 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">
                  Edit Course
                </a>
                {course.resumeLessonId ? (
                  <a href={`/learning/course/${course.id}/overview`} className="rounded-md bg-[#167495] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0c4e8a]">
                    Open Course
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      </div>
    </SectionLayout>
  );
}
