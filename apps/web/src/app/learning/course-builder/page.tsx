'use client';
import { useEffect, useState } from 'react';
import SectionLayout from '../../../components/crm/SectionLayout';
import { CONTRACTOR_MASTER_COURSE_TITLE } from '../../../lib/learning/catalog/contractor-liability-course';

interface CourseItem {
  id: string;
  title: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  modules: Array<{ id: string }>;
}

export default function CourseBuilderPage(): JSX.Element {
  const [courses, setCourses] = useState<CourseItem[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'>('BEGINNER');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importingFlagship, setImportingFlagship] = useState(false);

  async function loadCourses(): Promise<CourseItem[]> {
    const response = await fetch('/api/learning/courses/list');
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      throw new Error(payload.message ?? 'Failed to load courses.');
    }
    const payload = (await response.json()) as { courses?: CourseItem[] };
    const list = payload.courses ?? [];
    setCourses(list);
    return list;
  }

  async function ensureFlagshipCourse(existingCourses: CourseItem[]): Promise<void> {
    const existing = existingCourses.find((course) => course.title === CONTRACTOR_MASTER_COURSE_TITLE);
    if (existing) return;

    const response = await fetch('/api/learning/courses/import/contractor-liability-master', { method: 'POST' });
    if (!response.ok) {
      const payload = (await response.json()) as { message?: string };
      throw new Error(payload.message ?? 'Failed to import flagship course.');
    }
  }

  async function importFlagshipNow(): Promise<void> {
    setImportingFlagship(true);
    setError(null);

    try {
      await ensureFlagshipCourse(courses);
      await loadCourses();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import flagship course.');
    } finally {
      setImportingFlagship(false);
    }
  }

  async function rebuildFlagshipNow(): Promise<void> {
    setImportingFlagship(true);
    setError(null);

    try {
      const response = await fetch('/api/learning/courses/import/contractor-liability-master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRebuild: true }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { message?: string };
        throw new Error(payload.message ?? 'Failed to rebuild flagship course.');
      }

      await loadCourses();
    } catch (rebuildError) {
      setError(rebuildError instanceof Error ? rebuildError.message : 'Failed to rebuild flagship course.');
    } finally {
      setImportingFlagship(false);
    }
  }

  useEffect(() => {
    async function bootstrap(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const initialCourses = await loadCourses();
        await ensureFlagshipCourse(initialCourses);
        await loadCourses();
      } catch (initialError) {
        setError(initialError instanceof Error ? initialError.message : 'Failed to load courses.');
      } finally {
        setLoading(false);
      }
    }

    void bootstrap();
  }, []);

  async function createCourse(): Promise<void> {
    if (!title.trim()) {
      return;
    }

    await fetch('/api/learning/courses/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description, level }),
    });

    setTitle('');
    setDescription('');
    setLevel('BEGINNER');
    await loadCourses();
  }

  return (
    <SectionLayout title="Course Builder">
      <div className="space-y-4">
        <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <a href="/learning" className="rounded-md border border-[#c8ced3] px-3 py-1.5 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Back to Learning Center</a>
            <a href="/" className="rounded-md border border-[#c8ced3] px-3 py-1.5 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Exit Studio</a>
            <button
              type="button"
              onClick={() => {
                void importFlagshipNow();
              }}
              disabled={importingFlagship}
              className="rounded-md border border-[#167495] px-3 py-1.5 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff] disabled:opacity-60"
            >
              {importingFlagship ? 'Importing...' : 'Import Contractor Master Course'}
            </button>
            <button
              type="button"
              onClick={() => {
                void rebuildFlagshipNow();
              }}
              disabled={importingFlagship}
              className="rounded-md border border-[#a61b1b] px-3 py-1.5 text-xs font-semibold text-[#a61b1b] hover:bg-[#fff4f4] disabled:opacity-60"
            >
              {importingFlagship ? 'Rebuilding...' : 'Rebuild Course From Scratch'}
            </button>
            <button
              type="button"
              onClick={() => {
                void loadCourses();
              }}
              className="rounded-md border border-[#5c667a] px-3 py-1.5 text-xs font-semibold text-[#5c667a] hover:bg-[#f5f7fb]"
            >
              Refresh Studio Courses
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <h2 className="text-base font-bold text-[#23282c]">Create Course</h2>
          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
            <input
              className="rounded-md border border-[#c8ced3] px-3 py-2 text-sm"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Course title"
            />
            <input
              className="rounded-md border border-[#c8ced3] px-3 py-2 text-sm md:col-span-2"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
            />
            <select
              className="rounded-md border border-[#c8ced3] px-3 py-2 text-sm"
              value={level}
              onChange={(event) => {
                const value = event.target.value;
                if (value === 'BEGINNER' || value === 'INTERMEDIATE' || value === 'ADVANCED') {
                  setLevel(value);
                }
              }}
            >
              <option value="BEGINNER">Beginner</option>
              <option value="INTERMEDIATE">Intermediate</option>
              <option value="ADVANCED">Advanced</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              void createCourse();
            }}
            className="mt-3 rounded-md bg-[#23282c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#133a6b]"
          >
            + Create Course
          </button>
        </section>

        {loading ? <p className="text-sm text-[#514f4d]">Loading course studio...</p> : null}
        {error ? <p className="text-sm font-semibold text-[#a61b1b]">{error}</p> : null}

        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {courses.map((course) => (
            <a key={course.id} href={`/learning/course-builder/${course.id}`} className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm transition hover:border-[#167495]">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[#706e6b]">{course.level}</p>
              <h3 className="mt-1 text-sm font-bold text-[#23282c]">{course.title}</h3>
              <p className="mt-1 text-xs text-[#514f4d]">{course.modules.length} modules</p>
            </a>
          ))}
        </section>
      </div>
    </SectionLayout>
  );
}
