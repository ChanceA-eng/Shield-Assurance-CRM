'use client';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import SectionLayout from '../../../../components/crm/SectionLayout';

interface LessonItem {
  id: string;
}

interface ModuleItem {
  id: string;
  title: string;
  order: number;
  lessons: LessonItem[];
}

interface CourseItem {
  id: string;
  title: string;
  description: string | null;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  modules: ModuleItem[];
}

interface CourseSnapshotItem {
  id: string;
  label: string;
  createdAt: string;
}

function SortableModuleItem({ module, courseId }: { module: ModuleItem; courseId: string }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: module.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article ref={setNodeRef} style={style} className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab rounded border border-[#c8ced3] px-2 py-1 text-[10px] font-semibold text-[#514f4d]"
            aria-label="Drag module"
          >
            Drag
          </button>
          <h3 className="text-sm font-semibold text-[#23282c]">{module.title}</h3>
        </div>
        <a href={`/learning/course-builder/${courseId}/module/${module.id}`} className="text-xs font-semibold text-[#167495] hover:text-[#0c4e8a]">
          Edit Lessons
        </a>
      </div>
      <p className="mt-1 text-xs text-[#514f4d]">{module.lessons.length} lessons</p>
    </article>
  );
}

export default function CourseEditorPage(): JSX.Element {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;

  const [course, setCourse] = useState<CourseItem | null>(null);
  const [moduleTitle, setModuleTitle] = useState('');
  const [courseTitle, setCourseTitle] = useState('');
  const [courseDescription, setCourseDescription] = useState('');
  const [courseLevel, setCourseLevel] = useState<'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED'>('BEGINNER');
  const [moduleDrafts, setModuleDrafts] = useState<Record<string, string>>({});
  const [snapshots, setSnapshots] = useState<CourseSnapshotItem[]>([]);
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const sensors = useSensors(useSensor(PointerSensor));

  async function loadSnapshots(targetCourseId: string): Promise<void> {
    const response = await fetch(`/api/learning/snapshots/list?courseId=${encodeURIComponent(targetCourseId)}`);
    const payload = (await response.json()) as { snapshots?: CourseSnapshotItem[] };
    setSnapshots(payload.snapshots ?? []);
  }

  async function loadCourse(): Promise<void> {
    const response = await fetch('/api/learning/courses/list');
    const payload = (await response.json()) as { courses?: CourseItem[] };
    const found = (payload.courses ?? []).find((item) => item.id === courseId) ?? null;
    setCourse(found);
    if (found) {
      setCourseTitle(found.title);
      setCourseDescription(found.description ?? '');
      setCourseLevel(found.level);
      setModuleDrafts(Object.fromEntries(found.modules.map((item) => [item.id, item.title])));
      await loadSnapshots(found.id);
    }
  }

  useEffect(() => {
    if (courseId) {
      void loadCourse();
    }
  }, [courseId]);

  async function addModule(): Promise<void> {
    if (!courseId || !moduleTitle.trim()) {
      return;
    }

    await fetch('/api/learning/modules/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, title: moduleTitle }),
    });

    setModuleTitle('');
    await loadCourse();
  }

  async function persistModuleOrder(modules: ModuleItem[]): Promise<void> {
    await Promise.all(
      modules.map((module, index) => fetch('/api/learning/modules/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: module.id, order: index }),
      })),
    );
  }

  async function saveCourseDetails(): Promise<void> {
    if (!course) return;

    await fetch('/api/learning/courses/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: course.id,
        title: courseTitle,
        description: courseDescription,
        level: courseLevel,
      }),
    });

    await loadCourse();
  }

  async function removeCourse(): Promise<void> {
    if (!course) return;

    await fetch('/api/learning/courses/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: course.id }),
    });

    window.location.href = '/learning/course-builder';
  }

  async function saveModule(moduleId: string): Promise<void> {
    const title = moduleDrafts[moduleId];
    if (!title || !title.trim()) return;

    await fetch('/api/learning/modules/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: moduleId, title: title.trim() }),
    });

    await loadCourse();
  }

  async function removeModule(moduleId: string): Promise<void> {
    await fetch('/api/learning/modules/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: moduleId }),
    });

    await loadCourse();
  }

  async function duplicateModule(moduleId: string): Promise<void> {
    await fetch('/api/learning/modules/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ moduleId }),
    });

    await loadCourse();
  }

  async function createSnapshot(): Promise<void> {
    if (!course) return;

    await fetch('/api/learning/snapshots/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: course.id,
        label: snapshotLabel.trim() || undefined,
      }),
    });

    setSnapshotLabel('');
    await loadSnapshots(course.id);
  }

  async function restoreSnapshot(snapshotId: string): Promise<void> {
    await fetch('/api/learning/snapshots/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshotId }),
    });

    await loadCourse();
  }

  function onModuleDragEnd(event: DragEndEvent): void {
    if (!course) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = course.modules.findIndex((item) => item.id === active.id);
    const newIndex = course.modules.findIndex((item) => item.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(course.modules, oldIndex, newIndex).map((item, index) => ({ ...item, order: index }));
    setCourse({ ...course, modules: reordered });
    void persistModuleOrder(reordered);
  }

  return (
    <SectionLayout title="Course Editor">
      {!course ? <p className="text-sm text-[#514f4d]">Loading course...</p> : null}

      {course ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <a href="/learning/course-builder" className="rounded-md border border-[#c8ced3] px-3 py-1.5 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Back to Studio Courses</a>
              <a href="/learning" className="rounded-md border border-[#c8ced3] px-3 py-1.5 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Back to Learning Center</a>
              <a href="/" className="rounded-md border border-[#c8ced3] px-3 py-1.5 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Exit Studio</a>
            </div>
          </section>

          <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-[#23282c]">{course.title}</h2>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <input
                value={courseTitle}
                onChange={(event) => setCourseTitle(event.target.value)}
                className="rounded-md border border-[#c8ced3] px-3 py-2 text-sm"
                placeholder="Course title"
              />
              <input
                value={courseDescription}
                onChange={(event) => setCourseDescription(event.target.value)}
                className="rounded-md border border-[#c8ced3] px-3 py-2 text-sm md:col-span-2"
                placeholder="Description"
              />
              <select
                className="rounded-md border border-[#c8ced3] px-3 py-2 text-sm"
                value={courseLevel}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'BEGINNER' || value === 'INTERMEDIATE' || value === 'ADVANCED') {
                    setCourseLevel(value);
                  }
                }}
              >
                <option value="BEGINNER">Beginner</option>
                <option value="INTERMEDIATE">Intermediate</option>
                <option value="ADVANCED">Advanced</option>
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void saveCourseDetails();
                }}
                className="rounded-md border border-[#167495] px-3 py-1 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff]"
              >
                Save Course Details
              </button>
              <button
                type="button"
                onClick={() => {
                  void removeCourse();
                }}
                className="rounded-md border border-[#a61b1b] px-3 py-1 text-xs font-semibold text-[#a61b1b] hover:bg-[#fff4f4]"
              >
                Delete Course
              </button>
            </div>
            <div className="mt-3 rounded-md border border-[#d9e3f1] bg-[#f6f9ff] p-3">
              <p className="text-xs font-semibold text-[#234067]">Studio Snapshots</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={snapshotLabel}
                  onChange={(event) => setSnapshotLabel(event.target.value)}
                  className="min-w-[14rem] flex-1 rounded border border-[#c8ced3] px-2 py-1 text-xs"
                  placeholder="Snapshot label (optional)"
                />
                <button
                  type="button"
                  onClick={() => {
                    void createSnapshot();
                  }}
                  className="rounded border border-[#167495] px-2 py-1 text-[11px] font-semibold text-[#167495] hover:bg-[#eef5ff]"
                >
                  Save Snapshot
                </button>
              </div>
              {snapshots.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {snapshots.slice(0, 6).map((snapshot) => (
                    <button
                      key={snapshot.id}
                      type="button"
                      onClick={() => {
                        void restoreSnapshot(snapshot.id);
                      }}
                      className="rounded border border-[#c9d8ee] bg-white px-2 py-1 text-[11px] font-semibold text-[#234067] hover:border-[#167495]"
                    >
                      Restore: {snapshot.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="min-w-[16rem] flex-1 rounded-md border border-[#c8ced3] px-3 py-2 text-sm"
                value={moduleTitle}
                onChange={(event) => setModuleTitle(event.target.value)}
                placeholder="New module title"
              />
              <button
                type="button"
                onClick={() => {
                  void addModule();
                }}
                className="rounded-md bg-[#23282c] px-3 py-2 text-xs font-semibold text-white hover:bg-[#133a6b]"
              >
                + Add Module
              </button>
            </div>
          </section>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onModuleDragEnd}>
            <SortableContext items={course.modules.map((item) => item.id)} strategy={verticalListSortingStrategy}>
              <section className="space-y-3">
                {course.modules.map((module) => (
                  <div key={module.id} className="space-y-2">
                    <SortableModuleItem module={module} courseId={course.id} />
                    <div className="rounded border border-[#e4e5e6] bg-white px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={moduleDrafts[module.id] ?? ''}
                          onChange={(event) => {
                            setModuleDrafts((current) => ({
                              ...current,
                              [module.id]: event.target.value,
                            }));
                          }}
                          className="min-w-[16rem] flex-1 rounded border border-[#c8ced3] px-2 py-1 text-xs"
                          placeholder="Module title"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void saveModule(module.id);
                          }}
                          className="rounded border border-[#167495] px-2 py-1 text-[11px] font-semibold text-[#167495] hover:bg-[#eef5ff]"
                        >
                          Save Module
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void duplicateModule(module.id);
                          }}
                          className="rounded border border-[#5c667a] px-2 py-1 text-[11px] font-semibold text-[#5c667a] hover:bg-[#f5f7fb]"
                        >
                          Duplicate Module
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void removeModule(module.id);
                          }}
                          className="rounded border border-[#a61b1b] px-2 py-1 text-[11px] font-semibold text-[#a61b1b] hover:bg-[#fff4f4]"
                        >
                          Delete Module
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </section>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}
    </SectionLayout>
  );
}
