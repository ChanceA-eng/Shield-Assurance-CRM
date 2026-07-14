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
import { LearningBlockType, LearningContentType } from '@prisma/client';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import SectionLayout from '../../../../../../components/crm/SectionLayout';
import {
  createDefaultLessonExperience,
  parseLessonExperience,
  serializeLessonExperience,
  type LessonExperience,
} from '../../../../../../lib/learning/lesson-structure';
import { normalizeQuizOptions, type QuizOption } from '../../../../../../lib/learning/quiz-options';

interface QuizItem {
  id: string;
  question: string;
  answer: number;
  options: unknown;
}

interface LessonBlockItem {
  id: string;
  order: number;
  type: LearningBlockType;
  title: string | null;
  content: unknown;
}

interface LessonItem {
  id: string;
  title: string;
  order: number;
  contentType: LearningContentType;
  contentUrl: string | null;
  body: string | null;
  quizzes: QuizItem[];
  blocks: LessonBlockItem[];
}

interface ModuleItem {
  id: string;
  title: string;
  lessons: LessonItem[];
}

interface CourseItem {
  id: string;
  modules: ModuleItem[];
}

interface LessonDraft {
  title: string;
  contentType: LearningContentType;
  contentUrl: string;
  body: string;
}

interface QuizDraft {
  question: string;
  answer: number;
  options: QuizOption[];
}

interface BlockDraft {
  title: string;
  body: string;
  url: string;
  type: LearningBlockType;
  order: number;
}

interface LessonStructureDraft {
  readingTimeMinutes: number;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  introduction: string;
  objectives: string;
  lexicon: string;
  deepDiveHeading: string;
  caseLawCitation: string;
  coreDoctrine: string;
  scenarios: string;
  strategyName: string;
  script: string;
}

function asContentObject(content: unknown): Record<string, string> {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return {};
  }

  return content as Record<string, string>;
}

function toStructureDraft(experience: LessonExperience): LessonStructureDraft {
  return {
    readingTimeMinutes: experience.meta.readingTimeMinutes,
    difficulty: experience.meta.difficulty,
    introduction: experience.introduction,
    objectives: experience.learningObjectives.join('\n'),
    lexicon: experience.lexicon.map((item) => `${item.term}: ${item.definition}`).join('\n'),
    deepDiveHeading: experience.technicalDeepDive.heading,
    caseLawCitation: experience.technicalDeepDive.caseLawCitation,
    coreDoctrine: experience.technicalDeepDive.coreDoctrine,
    scenarios: experience.technicalDeepDive.scenarios.map((item) => `${item.type}: ${item.description}`).join('\n'),
    strategyName: experience.fieldExecution.strategyName,
    script: experience.fieldExecution.script,
  };
}

function fromStructureDraft(lessonTitle: string, draft: LessonStructureDraft): LessonExperience {
  const next = createDefaultLessonExperience(lessonTitle);
  next.meta.readingTimeMinutes = Math.max(1, Math.round(draft.readingTimeMinutes || 10));
  next.meta.difficulty = draft.difficulty;
  next.introduction = draft.introduction.trim();
  next.learningObjectives = draft.objectives
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  next.lexicon = draft.lexicon
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [term, ...rest] = line.split(':');
      return {
        term: term.trim(),
        definition: rest.join(':').trim(),
      };
    })
    .filter((item) => item.term.length > 0 && item.definition.length > 0);

  next.technicalDeepDive.heading = draft.deepDiveHeading.trim();
  next.technicalDeepDive.caseLawCitation = draft.caseLawCitation.trim();
  next.technicalDeepDive.coreDoctrine = draft.coreDoctrine.trim();
  next.technicalDeepDive.scenarios = draft.scenarios
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [type, ...rest] = line.split(':');
      return {
        type: type.trim(),
        description: rest.join(':').trim(),
      };
    })
    .filter((item) => item.type.length > 0 && item.description.length > 0);

  next.fieldExecution.strategyName = draft.strategyName.trim();
  next.fieldExecution.script = draft.script.trim();
  return next;
}

function SortableLessonItem({ lesson }: { lesson: LessonItem }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: lesson.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <article ref={setNodeRef} style={style} className="rounded-lg border border-[#dddbda] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="cursor-grab rounded border border-[#c9c7c5] px-2 py-1 text-[10px] font-semibold text-[#514f4d]"
          >
            Drag
          </button>
          <div>
            <h4 className="text-sm font-semibold text-[#080707]">{lesson.title}</h4>
            <p className="text-xs text-[#514f4d]">
              Type: {lesson.contentType.toLowerCase()} | Quizzes: {lesson.quizzes.length} | Blocks: {lesson.blocks.length}
            </p>
          </div>
        </div>
        <a href={`/learning/lesson/${lesson.id}?lessonId=${lesson.id}`} className="text-xs font-semibold text-[#0f62af] hover:text-[#0c4e8a]">
          Open Lesson
        </a>
      </div>
    </article>
  );
}

function SortableBlockItem({ blockId, children }: { blockId: string; children: JSX.Element }): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: blockId });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div ref={setNodeRef} style={style}>
      <div className="mb-1">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab rounded border border-[#c9c7c5] px-2 py-1 text-[10px] font-semibold text-[#514f4d]"
        >
          Drag Block
        </button>
      </div>
      {children}
    </div>
  );
}

function EditorToolbar({ onApply }: { onApply: (snippet: string) => void }): JSX.Element {
  return (
    <div className="mb-1 flex flex-wrap gap-1">
      <button type="button" onClick={() => onApply('## Heading')} className="rounded border border-[#c9c7c5] px-2 py-0.5 text-[10px] font-semibold text-[#514f4d]">H2</button>
      <button type="button" onClick={() => onApply('**bold**')} className="rounded border border-[#c9c7c5] px-2 py-0.5 text-[10px] font-semibold text-[#514f4d]">Bold</button>
      <button type="button" onClick={() => onApply('- bullet item')} className="rounded border border-[#c9c7c5] px-2 py-0.5 text-[10px] font-semibold text-[#514f4d]">Bullet</button>
      <button type="button" onClick={() => onApply('> key point')} className="rounded border border-[#c9c7c5] px-2 py-0.5 text-[10px] font-semibold text-[#514f4d]">Quote</button>
      <button type="button" onClick={() => onApply('`term`')} className="rounded border border-[#c9c7c5] px-2 py-0.5 text-[10px] font-semibold text-[#514f4d]">Inline Code</button>
      <button type="button" onClick={() => onApply('```\ncode\n```')} className="rounded border border-[#c9c7c5] px-2 py-0.5 text-[10px] font-semibold text-[#514f4d]">Code Block</button>
    </div>
  );
}

export default function ModuleEditorPage(): JSX.Element {
  const params = useParams<{ courseId: string; moduleId: string }>();
  const courseId = params.courseId;
  const moduleId = params.moduleId;

  const [module, setModule] = useState<ModuleItem | null>(null);
  const [lessonTitle, setLessonTitle] = useState('');
  const [contentType, setContentType] = useState<LearningContentType>(LearningContentType.TEXT);
  const [contentUrl, setContentUrl] = useState('');
  const [body, setBody] = useState('');

  const [quizLessonId, setQuizLessonId] = useState<string>('');
  const [quizQuestion, setQuizQuestion] = useState('');
  const [quizOptions, setQuizOptions] = useState<QuizOption[]>([
    { text: '', explanation: '' },
    { text: '', explanation: '' },
    { text: '', explanation: '' },
    { text: '', explanation: '' },
  ]);
  const [quizAnswer, setQuizAnswer] = useState(0);

  const [blockLessonId, setBlockLessonId] = useState<string>('');
  const [blockType, setBlockType] = useState<LearningBlockType>(LearningBlockType.TEXT);
  const [blockTitle, setBlockTitle] = useState('');
  const [blockBody, setBlockBody] = useState('');
  const [blockUrl, setBlockUrl] = useState('');

  const [lessonDrafts, setLessonDrafts] = useState<Record<string, LessonDraft>>({});
  const [lessonStructureDrafts, setLessonStructureDrafts] = useState<Record<string, LessonStructureDraft>>({});
  const [quizDrafts, setQuizDrafts] = useState<Record<string, QuizDraft>>({});
  const [blockDrafts, setBlockDrafts] = useState<Record<string, BlockDraft>>({});

  const sensors = useSensors(useSensor(PointerSensor));

  const sortedLessons = useMemo(
    () => (module?.lessons ?? []).slice().sort((left, right) => left.order - right.order),
    [module],
  );

  function appendSnippet(value: string, snippet: string): string {
    if (!value.trim()) return snippet;
    return `${value}\n${snippet}`;
  }

  async function loadModule(): Promise<void> {
    const response = await fetch('/api/learning/courses/list');
    const payload = (await response.json()) as { courses?: CourseItem[] };
    const courses = payload.courses ?? [];
    const match = courses.flatMap((course) => course.modules).find((item) => item.id === moduleId) ?? null;
    setModule(match);

    if (!match) return;

    setLessonDrafts(Object.fromEntries(match.lessons.map((lesson) => [lesson.id, {
      title: lesson.title,
      contentType: lesson.contentType,
      contentUrl: lesson.contentUrl ?? '',
      body: lesson.body ?? '',
    }])));

    setLessonStructureDrafts(Object.fromEntries(match.lessons.map((lesson) => {
      const parsed = parseLessonExperience(lesson.body, lesson.title) ?? createDefaultLessonExperience(lesson.title);
      return [lesson.id, toStructureDraft(parsed)];
    })));

    setQuizDrafts(Object.fromEntries(match.lessons.flatMap((lesson) => lesson.quizzes.map((quiz) => {
      const options = normalizeQuizOptions(quiz.options);
      return [quiz.id, {
        question: quiz.question,
        answer: quiz.answer,
        options: options.length > 0 ? options : [
          { text: '', explanation: '' },
          { text: '', explanation: '' },
        ],
      }];
    }))));

    setBlockDrafts(Object.fromEntries(match.lessons.flatMap((lesson) => lesson.blocks.map((block) => {
      const content = asContentObject(block.content);
      return [block.id, {
        title: block.title ?? '',
        body: content.body ?? '',
        url: content.url ?? '',
        type: block.type,
        order: block.order,
      }];
    }))));

    if (match.lessons.length > 0 && !quizLessonId) setQuizLessonId(match.lessons[0].id);
    if (match.lessons.length > 0 && !blockLessonId) setBlockLessonId(match.lessons[0].id);
  }

  useEffect(() => {
    if (moduleId) {
      void loadModule();
    }
  }, [moduleId]);

  async function addLesson(): Promise<void> {
    if (!lessonTitle.trim()) return;

    await fetch('/api/learning/lessons/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        moduleId,
        title: lessonTitle,
        contentType,
        contentUrl: contentType === LearningContentType.TEXT || contentType === LearningContentType.INTERACTIVE ? null : contentUrl,
        body: contentType === LearningContentType.TEXT || contentType === LearningContentType.INTERACTIVE ? body : null,
      }),
    });

    setLessonTitle('');
    setContentUrl('');
    setBody('');
    await loadModule();
  }

  async function duplicateLesson(lessonId: string): Promise<void> {
    await fetch('/api/learning/lessons/duplicate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId }),
    });

    await loadModule();
  }

  async function saveLesson(lessonId: string): Promise<void> {
    const draft = lessonDrafts[lessonId];
    if (!draft || !draft.title.trim()) return;

    const structureDraft = lessonStructureDrafts[lessonId];
    const structuredBody = structureDraft
      ? serializeLessonExperience(fromStructureDraft(draft.title.trim(), structureDraft))
      : draft.body;

    await fetch('/api/learning/lessons/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: lessonId,
        title: draft.title.trim(),
        contentType: draft.contentType,
        contentUrl: draft.contentType === LearningContentType.TEXT || draft.contentType === LearningContentType.INTERACTIVE ? null : draft.contentUrl,
        body: draft.contentType === LearningContentType.TEXT || draft.contentType === LearningContentType.INTERACTIVE ? structuredBody : null,
      }),
    });

    await loadModule();
  }

  async function removeLesson(lessonId: string): Promise<void> {
    await fetch('/api/learning/lessons/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lessonId }),
    });
    await loadModule();
  }

  async function addQuiz(): Promise<void> {
    const options = quizOptions
      .map((option) => ({ text: option.text.trim(), explanation: option.explanation?.trim() ?? '' }))
      .filter((option) => option.text.length > 0);

    if (!quizLessonId || !quizQuestion.trim() || options.length < 2 || quizAnswer < 0 || quizAnswer >= options.length) {
      return;
    }

    await fetch('/api/learning/quizzes/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lessonId: quizLessonId,
        question: quizQuestion,
        options,
        answer: quizAnswer,
      }),
    });

    setQuizQuestion('');
    setQuizOptions([
      { text: '', explanation: '' },
      { text: '', explanation: '' },
      { text: '', explanation: '' },
      { text: '', explanation: '' },
    ]);
    setQuizAnswer(0);
    await loadModule();
  }

  async function saveQuiz(quizId: string): Promise<void> {
    const draft = quizDrafts[quizId];
    if (!draft || !draft.question.trim()) return;

    const options = draft.options
      .map((option) => ({ text: option.text.trim(), explanation: option.explanation?.trim() ?? '' }))
      .filter((option) => option.text.length > 0);

    if (options.length < 2 || draft.answer < 0 || draft.answer >= options.length) {
      return;
    }

    await fetch('/api/learning/quizzes/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: quizId,
        question: draft.question,
        options,
        answer: draft.answer,
      }),
    });

    await loadModule();
  }

  async function removeQuiz(quizId: string): Promise<void> {
    await fetch('/api/learning/quizzes/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: quizId }),
    });

    await loadModule();
  }

  function applyTemplate(template: 'UNDERWRITING_SCENARIO' | 'CODE_DRILL' | 'PDF_BRIEF'): void {
    if (template === 'UNDERWRITING_SCENARIO') {
      setBlockType(LearningBlockType.SIMULATION);
      setBlockTitle('Underwriting Scenario');
      setBlockBody('Scenario:\nContractor has mixed operations and an aggressive indemnity clause.\n\nTask:\n1) Coverage map\n2) Exclusion analysis\n3) Recommended transfer language.');
      setBlockUrl('');
      return;
    }

    if (template === 'CODE_DRILL') {
      setBlockType(LearningBlockType.CODE);
      setBlockTitle('Code Drill');
      setBlockBody('function classifyClaim(input) {\n  // TODO: classify tort/contract/statutory and policy trigger\n}\n');
      setBlockUrl('');
      return;
    }

    setBlockType(LearningBlockType.PDF);
    setBlockTitle('PDF Brief');
    setBlockBody('Summarize this document and extract underwriting action points.');
    setBlockUrl('https://');
  }

  async function addBlock(): Promise<void> {
    if (!blockLessonId) return;

    const content: Record<string, string> = {};
    if (blockBody.trim()) content.body = blockBody.trim();
    if (blockUrl.trim()) content.url = blockUrl.trim();

    await fetch('/api/learning/blocks/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lessonId: blockLessonId, type: blockType, title: blockTitle, content }),
    });

    setBlockTitle('');
    setBlockBody('');
    setBlockUrl('');
    await loadModule();
  }

  async function saveBlock(blockId: string): Promise<void> {
    const draft = blockDrafts[blockId];
    if (!draft) return;

    await fetch('/api/learning/blocks/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: blockId,
        title: draft.title,
        type: draft.type,
        order: draft.order,
        content: { body: draft.body, url: draft.url },
      }),
    });

    await loadModule();
  }

  async function removeBlock(blockId: string): Promise<void> {
    await fetch('/api/learning/blocks/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: blockId }),
    });

    await loadModule();
  }

  async function persistLessonOrder(lessons: LessonItem[]): Promise<void> {
    await Promise.all(lessons.map((lesson, index) => fetch('/api/learning/lessons/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: lesson.id, order: index }),
    })));
  }

  async function persistBlockOrder(lessonId: string, blocks: LessonBlockItem[]): Promise<void> {
    await Promise.all(blocks.map((block, index) => fetch('/api/learning/blocks/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: block.id, order: index }),
    })));

    setBlockDrafts((current) => {
      const next = { ...current };
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i];
        if (next[block.id]) {
          next[block.id] = { ...next[block.id], order: i };
        }
      }
      return next;
    });

    await loadModule();
  }

  function onLessonDragEnd(event: DragEndEvent): void {
    if (!module) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = module.lessons.findIndex((lesson) => lesson.id === active.id);
    const newIndex = module.lessons.findIndex((lesson) => lesson.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextLessons = arrayMove(module.lessons, oldIndex, newIndex).map((lesson, index) => ({ ...lesson, order: index }));
    setModule({ ...module, lessons: nextLessons });
    void persistLessonOrder(nextLessons);
  }

  function onBlockDragEnd(lessonId: string, event: DragEndEvent): void {
    if (!module) return;

    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const lesson = module.lessons.find((item) => item.id === lessonId);
    if (!lesson) return;

    const ordered = lesson.blocks.slice().sort((left, right) => left.order - right.order);
    const oldIndex = ordered.findIndex((block) => block.id === active.id);
    const newIndex = ordered.findIndex((block) => block.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextBlocks = arrayMove(ordered, oldIndex, newIndex).map((block, index) => ({ ...block, order: index }));
    const nextModule = {
      ...module,
      lessons: module.lessons.map((item) => (item.id === lessonId ? { ...item, blocks: nextBlocks } : item)),
    };

    setModule(nextModule);
    void persistBlockOrder(lessonId, nextBlocks);
  }

  return (
    <SectionLayout title="Module Studio">
      {!module ? <p className="text-sm text-[#514f4d]">Loading module...</p> : null}

      {module ? (
        <div className="space-y-4">
          <section className="rounded-lg border border-[#dddbda] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <a href={`/learning/course-builder/${courseId}`} className="rounded-md border border-[#c9c7c5] px-3 py-1.5 text-xs font-semibold text-[#0b2545] hover:bg-[#f3f2f1]">Back to Course Editor</a>
              <a href="/learning/course-builder" className="rounded-md border border-[#c9c7c5] px-3 py-1.5 text-xs font-semibold text-[#0b2545] hover:bg-[#f3f2f1]">Back to Studio Courses</a>
              <a href="/learning" className="rounded-md border border-[#c9c7c5] px-3 py-1.5 text-xs font-semibold text-[#0b2545] hover:bg-[#f3f2f1]">Back to Learning Center</a>
              <a href="/" className="rounded-md border border-[#c9c7c5] px-3 py-1.5 text-xs font-semibold text-[#0b2545] hover:bg-[#f3f2f1]">Exit Studio</a>
            </div>
          </section>

          <section className="rounded-lg border border-[#dddbda] bg-white p-4 shadow-sm">
            <h2 className="text-lg font-bold text-[#080707]">{module.title}</h2>
            <p className="mt-1 text-xs text-[#514f4d]">Create and edit lessons, knowledge checks, and interactive blocks.</p>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
              <input className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm md:col-span-2" placeholder="Lesson title" value={lessonTitle} onChange={(event) => setLessonTitle(event.target.value)} />
              <select className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" value={contentType} onChange={(event) => {
                const value = event.target.value;
                if (value === LearningContentType.TEXT || value === LearningContentType.INTERACTIVE || value === LearningContentType.VIDEO || value === LearningContentType.PDF) {
                  setContentType(value);
                }
              }}>
                <option value={LearningContentType.TEXT}>Text</option>
                <option value={LearningContentType.INTERACTIVE}>Interactive</option>
                <option value={LearningContentType.VIDEO}>Video</option>
                <option value={LearningContentType.PDF}>PDF</option>
              </select>
              <button type="button" onClick={() => { void addLesson(); }} className="rounded-md bg-[#0b2545] px-3 py-2 text-xs font-semibold text-white hover:bg-[#133a6b]">+ Add Lesson</button>
            </div>

            {(contentType === LearningContentType.VIDEO || contentType === LearningContentType.PDF) ? (
              <input className="mt-2 w-full rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" placeholder="Media URL" value={contentUrl} onChange={(event) => setContentUrl(event.target.value)} />
            ) : null}

            {(contentType === LearningContentType.TEXT || contentType === LearningContentType.INTERACTIVE) ? (
              <>
                <EditorToolbar onApply={(snippet) => setBody((current) => appendSnippet(current, snippet))} />
                <textarea className="h-28 w-full rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" placeholder="Lesson body" value={body} onChange={(event) => setBody(event.target.value)} />
              </>
            ) : null}
          </section>

          <section className="rounded-lg border border-[#dddbda] bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-[#080707]">Quiz Builder (with answer explanations)</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <select className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" value={quizLessonId} onChange={(event) => setQuizLessonId(event.target.value)}>
                <option value="">Select lesson</option>
                {sortedLessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
              </select>
              <input className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" value={quizQuestion} onChange={(event) => setQuizQuestion(event.target.value)} placeholder="Question" />
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2">
              {quizOptions.map((option, index) => (
                <div key={`new-opt-${index}`} className="rounded border border-[#ecebea] p-2">
                  <input
                    className="w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                    value={option.text}
                    onChange={(event) => {
                      setQuizOptions((current) => {
                        const next = [...current];
                        next[index] = { ...next[index], text: event.target.value };
                        return next;
                      });
                    }}
                    placeholder={`Option ${index + 1}`}
                  />
                  <input
                    className="mt-1 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                    value={option.explanation ?? ''}
                    onChange={(event) => {
                      setQuizOptions((current) => {
                        const next = [...current];
                        next[index] = { ...next[index], explanation: event.target.value };
                        return next;
                      });
                    }}
                    placeholder="Explanation shown after answer"
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-xs text-[#514f4d]" htmlFor="answer-index">Correct option index:</label>
              <input id="answer-index" type="number" min={0} max={3} value={quizAnswer} onChange={(event) => setQuizAnswer(Number(event.target.value) || 0)} className="w-20 rounded-md border border-[#c9c7c5] px-2 py-1 text-sm" />
              <button type="button" onClick={() => { void addQuiz(); }} className="rounded-md border border-[#0f62af] px-3 py-1 text-xs font-semibold text-[#0f62af] hover:bg-[#eef5ff]">+ Add Quiz</button>
            </div>
          </section>

          <section className="rounded-lg border border-[#dddbda] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-[#080707]">Interactive Block Builder</h3>
              <div className="flex flex-wrap gap-1">
                <button type="button" className="rounded border border-[#c9c7c5] px-2 py-1 text-[10px] font-semibold text-[#514f4d]" onClick={() => applyTemplate('UNDERWRITING_SCENARIO')}>Template: Scenario</button>
                <button type="button" className="rounded border border-[#c9c7c5] px-2 py-1 text-[10px] font-semibold text-[#514f4d]" onClick={() => applyTemplate('CODE_DRILL')}>Template: Code Drill</button>
                <button type="button" className="rounded border border-[#c9c7c5] px-2 py-1 text-[10px] font-semibold text-[#514f4d]" onClick={() => applyTemplate('PDF_BRIEF')}>Template: PDF Brief</button>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              <select className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" value={blockLessonId} onChange={(event) => setBlockLessonId(event.target.value)}>
                <option value="">Select lesson</option>
                {sortedLessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}
              </select>
              <select className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm" value={blockType} onChange={(event) => {
                const value = event.target.value;
                if (
                  value === LearningBlockType.TEXT || value === LearningBlockType.CODE || value === LearningBlockType.EXERCISE || value === LearningBlockType.SIMULATION || value === LearningBlockType.VIDEO || value === LearningBlockType.PDF || value === LearningBlockType.QUIZ
                ) setBlockType(value);
              }}>
                <option value={LearningBlockType.TEXT}>Text</option>
                <option value={LearningBlockType.CODE}>Code</option>
                <option value={LearningBlockType.EXERCISE}>Exercise</option>
                <option value={LearningBlockType.SIMULATION}>Simulation</option>
                <option value={LearningBlockType.VIDEO}>Video</option>
                <option value={LearningBlockType.PDF}>PDF</option>
                <option value={LearningBlockType.QUIZ}>Quiz Prompt</option>
              </select>
              <input className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm md:col-span-2" value={blockTitle} onChange={(event) => setBlockTitle(event.target.value)} placeholder="Block title" />
              <EditorToolbar onApply={(snippet) => setBlockBody((current) => appendSnippet(current, snippet))} />
              <textarea className="h-28 rounded-md border border-[#c9c7c5] px-3 py-2 text-sm md:col-span-2" value={blockBody} onChange={(event) => setBlockBody(event.target.value)} placeholder="Block body / instructions" />
              <input className="rounded-md border border-[#c9c7c5] px-3 py-2 text-sm md:col-span-2" value={blockUrl} onChange={(event) => setBlockUrl(event.target.value)} placeholder="Optional media URL" />
            </div>
            <button type="button" onClick={() => { void addBlock(); }} className="mt-3 rounded-md border border-[#0f62af] px-3 py-1 text-xs font-semibold text-[#0f62af] hover:bg-[#eef5ff]">+ Add Block</button>
          </section>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onLessonDragEnd}>
            <SortableContext items={sortedLessons.map((lesson) => lesson.id)} strategy={verticalListSortingStrategy}>
              <section className="space-y-3">
                {sortedLessons.map((lesson) => {
                  const lessonDraft = lessonDrafts[lesson.id] ?? {
                    title: lesson.title,
                    contentType: lesson.contentType,
                    contentUrl: lesson.contentUrl ?? '',
                    body: lesson.body ?? '',
                  };

                  const sortedBlocks = lesson.blocks.slice().sort((left, right) => left.order - right.order);

                  return (
                    <div key={lesson.id} className="space-y-2">
                      <SortableLessonItem lesson={lesson} />

                      <div className="rounded border border-[#e5e5e5] bg-white p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input value={lessonDraft.title} onChange={(event) => setLessonDrafts((current) => ({ ...current, [lesson.id]: { ...lessonDraft, title: event.target.value } }))} className="min-w-[16rem] flex-1 rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Lesson title" />
                          <select value={lessonDraft.contentType} onChange={(event) => {
                            const value = event.target.value;
                            if (value === LearningContentType.TEXT || value === LearningContentType.INTERACTIVE || value === LearningContentType.VIDEO || value === LearningContentType.PDF) {
                              setLessonDrafts((current) => ({ ...current, [lesson.id]: { ...lessonDraft, contentType: value } }));
                            }
                          }} className="rounded border border-[#c9c7c5] px-2 py-1 text-xs">
                            <option value={LearningContentType.TEXT}>Text</option>
                            <option value={LearningContentType.INTERACTIVE}>Interactive</option>
                            <option value={LearningContentType.VIDEO}>Video</option>
                            <option value={LearningContentType.PDF}>PDF</option>
                          </select>
                          <button type="button" onClick={() => { void saveLesson(lesson.id); }} className="rounded border border-[#0f62af] px-2 py-1 text-[11px] font-semibold text-[#0f62af] hover:bg-[#eef5ff]">Save Lesson</button>
                          <button type="button" onClick={() => { void duplicateLesson(lesson.id); }} className="rounded border border-[#5c667a] px-2 py-1 text-[11px] font-semibold text-[#5c667a] hover:bg-[#f5f7fb]">Duplicate Lesson</button>
                          <button type="button" onClick={() => { void removeLesson(lesson.id); }} className="rounded border border-[#a61b1b] px-2 py-1 text-[11px] font-semibold text-[#a61b1b] hover:bg-[#fff4f4]">Delete Lesson</button>
                        </div>

                        {(lessonDraft.contentType === LearningContentType.VIDEO || lessonDraft.contentType === LearningContentType.PDF) ? (
                          <input value={lessonDraft.contentUrl} onChange={(event) => setLessonDrafts((current) => ({ ...current, [lesson.id]: { ...lessonDraft, contentUrl: event.target.value } }))} className="mt-2 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Lesson media URL" />
                        ) : null}

                        {(lessonDraft.contentType === LearningContentType.TEXT || lessonDraft.contentType === LearningContentType.INTERACTIVE) ? (
                          <div className="mt-2 space-y-2 rounded border border-[#dbe5f2] bg-[#f8fbff] p-3">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#244368]">Structured Lesson Experience Editor</p>
                            {(() => {
                              const structureDraft = lessonStructureDrafts[lesson.id] ?? toStructureDraft(createDefaultLessonExperience(lessonDraft.title));
                              return (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    <input
                                      type="number"
                                      min={1}
                                      value={structureDraft.readingTimeMinutes}
                                      onChange={(event) => setLessonStructureDrafts((current) => ({
                                        ...current,
                                        [lesson.id]: { ...structureDraft, readingTimeMinutes: Number(event.target.value) || 10 },
                                      }))}
                                      className="rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                      placeholder="Reading time (minutes)"
                                    />
                                    <select
                                      value={structureDraft.difficulty}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        if (value === 'Beginner' || value === 'Intermediate' || value === 'Advanced') {
                                          setLessonStructureDrafts((current) => ({
                                            ...current,
                                            [lesson.id]: { ...structureDraft, difficulty: value },
                                          }));
                                        }
                                      }}
                                      className="rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    >
                                      <option value="Beginner">Beginner</option>
                                      <option value="Intermediate">Intermediate</option>
                                      <option value="Advanced">Advanced</option>
                                    </select>
                                  </div>

                                  <textarea
                                    value={structureDraft.introduction}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, introduction: event.target.value } }))}
                                    className="h-16 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Introduction"
                                  />

                                  <textarea
                                    value={structureDraft.objectives}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, objectives: event.target.value } }))}
                                    className="h-20 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Learning objectives (one per line)"
                                  />

                                  <textarea
                                    value={structureDraft.lexicon}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, lexicon: event.target.value } }))}
                                    className="h-20 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Lexicon lines: Term: Definition"
                                  />

                                  <input
                                    value={structureDraft.deepDiveHeading}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, deepDiveHeading: event.target.value } }))}
                                    className="w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Technical deep dive heading"
                                  />
                                  <input
                                    value={structureDraft.caseLawCitation}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, caseLawCitation: event.target.value } }))}
                                    className="w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Case law citation"
                                  />
                                  <textarea
                                    value={structureDraft.coreDoctrine}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, coreDoctrine: event.target.value } }))}
                                    className="h-20 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Core doctrine"
                                  />
                                  <textarea
                                    value={structureDraft.scenarios}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, scenarios: event.target.value } }))}
                                    className="h-20 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Scenario lines: Lane Name: Description"
                                  />
                                  <input
                                    value={structureDraft.strategyName}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, strategyName: event.target.value } }))}
                                    className="w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Field execution strategy name"
                                  />
                                  <textarea
                                    value={structureDraft.script}
                                    onChange={(event) => setLessonStructureDrafts((current) => ({ ...current, [lesson.id]: { ...structureDraft, script: event.target.value } }))}
                                    className="h-24 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                    placeholder="Field execution script"
                                  />
                                </div>
                              );
                            })()}

                            <EditorToolbar onApply={(snippet) => setLessonDrafts((current) => ({ ...current, [lesson.id]: { ...lessonDraft, body: appendSnippet(lessonDraft.body, snippet) } }))} />
                            <textarea value={lessonDraft.body} onChange={(event) => setLessonDrafts((current) => ({ ...current, [lesson.id]: { ...lessonDraft, body: event.target.value } }))} className="mt-1 h-20 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Raw lesson body (legacy/plain text fallback)" />
                          </div>
                        ) : null}

                        {lesson.quizzes.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#514f4d]">Edit Quizzes</p>
                            {lesson.quizzes.map((quiz) => {
                              const draft = quizDrafts[quiz.id] ?? { question: quiz.question, answer: quiz.answer, options: normalizeQuizOptions(quiz.options) };

                              return (
                                <div key={quiz.id} className="rounded border border-[#ecebea] p-2">
                                  <input value={draft.question} onChange={(event) => setQuizDrafts((current) => ({ ...current, [quiz.id]: { ...draft, question: event.target.value } }))} className="w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Quiz question" />
                                  <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
                                    {draft.options.map((option, index) => (
                                      <div key={`${quiz.id}-opt-${index}`} className="rounded border border-[#ecebea] p-1">
                                        <input
                                          value={option.text}
                                          onChange={(event) => {
                                            setQuizDrafts((current) => {
                                              const next = [...draft.options];
                                              next[index] = { ...next[index], text: event.target.value };
                                              return { ...current, [quiz.id]: { ...draft, options: next } };
                                            });
                                          }}
                                          className="w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                          placeholder={`Option ${index + 1}`}
                                        />
                                        <input
                                          value={option.explanation ?? ''}
                                          onChange={(event) => {
                                            setQuizDrafts((current) => {
                                              const next = [...draft.options];
                                              next[index] = { ...next[index], explanation: event.target.value };
                                              return { ...current, [quiz.id]: { ...draft, options: next } };
                                            });
                                          }}
                                          className="mt-1 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs"
                                          placeholder="Explanation"
                                        />
                                      </div>
                                    ))}
                                  </div>
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <label className="text-[11px] text-[#514f4d]" htmlFor={`ans-${quiz.id}`}>Correct index:</label>
                                    <input id={`ans-${quiz.id}`} type="number" min={0} max={Math.max(draft.options.length - 1, 0)} value={draft.answer} onChange={(event) => setQuizDrafts((current) => ({ ...current, [quiz.id]: { ...draft, answer: Number(event.target.value) || 0 } }))} className="w-20 rounded border border-[#c9c7c5] px-2 py-1 text-xs" />
                                    <button type="button" onClick={() => { void saveQuiz(quiz.id); }} className="rounded border border-[#0f62af] px-2 py-1 text-[11px] font-semibold text-[#0f62af] hover:bg-[#eef5ff]">Save Quiz</button>
                                    <button type="button" onClick={() => { void removeQuiz(quiz.id); }} className="rounded border border-[#a61b1b] px-2 py-1 text-[11px] font-semibold text-[#a61b1b] hover:bg-[#fff4f4]">Delete Quiz</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}

                        {sortedBlocks.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#514f4d]">Edit Blocks (Drag to reorder)</p>
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => onBlockDragEnd(lesson.id, event)}>
                              <SortableContext items={sortedBlocks.map((block) => block.id)} strategy={verticalListSortingStrategy}>
                                <div className="space-y-2">
                                  {sortedBlocks.map((block) => {
                                    const draft = blockDrafts[block.id] ?? {
                                      title: block.title ?? '',
                                      body: asContentObject(block.content).body ?? '',
                                      url: asContentObject(block.content).url ?? '',
                                      type: block.type,
                                      order: block.order,
                                    };

                                    return (
                                      <SortableBlockItem key={block.id} blockId={block.id}>
                                        <div className="rounded border border-[#ecebea] p-2">
                                          <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
                                            <input value={draft.title} onChange={(event) => setBlockDrafts((current) => ({ ...current, [block.id]: { ...draft, title: event.target.value } }))} className="rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Block title" />
                                            <select value={draft.type} onChange={(event) => {
                                              const value = event.target.value;
                                              if (
                                                value === LearningBlockType.TEXT || value === LearningBlockType.CODE || value === LearningBlockType.EXERCISE || value === LearningBlockType.SIMULATION || value === LearningBlockType.VIDEO || value === LearningBlockType.PDF || value === LearningBlockType.QUIZ
                                              ) {
                                                setBlockDrafts((current) => ({ ...current, [block.id]: { ...draft, type: value } }));
                                              }
                                            }} className="rounded border border-[#c9c7c5] px-2 py-1 text-xs">
                                              <option value={LearningBlockType.TEXT}>Text</option>
                                              <option value={LearningBlockType.CODE}>Code</option>
                                              <option value={LearningBlockType.EXERCISE}>Exercise</option>
                                              <option value={LearningBlockType.SIMULATION}>Simulation</option>
                                              <option value={LearningBlockType.VIDEO}>Video</option>
                                              <option value={LearningBlockType.PDF}>PDF</option>
                                              <option value={LearningBlockType.QUIZ}>Quiz Prompt</option>
                                            </select>
                                            <input value={draft.url} onChange={(event) => setBlockDrafts((current) => ({ ...current, [block.id]: { ...draft, url: event.target.value } }))} className="rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Optional URL" />
                                          </div>
                                          <EditorToolbar onApply={(snippet) => setBlockDrafts((current) => ({ ...current, [block.id]: { ...draft, body: appendSnippet(draft.body, snippet) } }))} />
                                          <textarea value={draft.body} onChange={(event) => setBlockDrafts((current) => ({ ...current, [block.id]: { ...draft, body: event.target.value } }))} className="mt-1 h-20 w-full rounded border border-[#c9c7c5] px-2 py-1 text-xs" placeholder="Block body" />
                                          <div className="mt-1 flex flex-wrap gap-1">
                                            <button type="button" onClick={() => { void saveBlock(block.id); }} className="rounded border border-[#0f62af] px-2 py-1 text-[11px] font-semibold text-[#0f62af] hover:bg-[#eef5ff]">Save Block</button>
                                            <button type="button" onClick={() => { void removeBlock(block.id); }} className="rounded border border-[#a61b1b] px-2 py-1 text-[11px] font-semibold text-[#a61b1b] hover:bg-[#fff4f4]">Delete Block</button>
                                          </div>
                                        </div>
                                      </SortableBlockItem>
                                    );
                                  })}
                                </div>
                              </SortableContext>
                            </DndContext>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </section>
            </SortableContext>
          </DndContext>
        </div>
      ) : null}
    </SectionLayout>
  );
}
