'use client';

import { LearningContentType } from '@prisma/client';
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import {
  createDefaultLessonExperience,
  parseLessonExperience,
  type LessonExperience,
} from '../../lib/learning/lesson-structure';
import { normalizeQuizOptions } from '../../lib/learning/quiz-options';

interface LessonQuiz {
  id: string;
  question: string;
  options: unknown;
}

interface LessonDetail {
  id: string;
  title: string;
  contentType: LearningContentType;
  contentUrl: string | null;
  body: string | null;
  module: {
    id: string;
    title: string;
    course: {
      id: string;
      title: string;
    };
  };
  quizzes: LessonQuiz[];
  blocks: Array<{
    id: string;
    type: 'VIDEO' | 'PDF' | 'TEXT' | 'CODE' | 'QUIZ' | 'EXERCISE' | 'SIMULATION';
    title: string | null;
    content: unknown;
  }>;
}

interface QuizResult {
  quizId: string;
  correct: boolean;
  answer: number;
  selectedExplanation: string | null;
  correctExplanation: string | null;
}

interface LessonNavigationItem {
  id: string;
  title: string;
}

const blockTypeLabels: Record<LessonDetail['blocks'][number]['type'], string> = {
  VIDEO: 'Video Walkthrough',
  PDF: 'Reference Brief',
  TEXT: 'Operational Note',
  CODE: 'Code Drill',
  QUIZ: 'Knowledge Prompt',
  EXERCISE: 'Field Exercise',
  SIMULATION: 'Live-Fire Simulation',
};

function asContentObject(content: unknown): Record<string, unknown> {
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    return {};
  }

  return content as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const DEFAULT_LEARNER_KEY = 'open-access';

function learnerKey(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_LEARNER_KEY;
  }

  const key = 'learning_learner_key';
  const existing = window.localStorage.getItem(key);
  if (existing && existing.trim().length > 0) {
    return existing;
  }

  const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  window.localStorage.setItem(key, generated);
  return generated;
}

export default function LessonPlayer({ lessonId }: { lessonId: string }): JSX.Element {
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quizSelections, setQuizSelections] = useState<Record<string, number>>({});
  const [quizResults, setQuizResults] = useState<Record<string, QuizResult>>({});
  const [completing, setCompleting] = useState(false);
  const [simulationAnswers, setSimulationAnswers] = useState<Record<string, string>>({});
  const [simulationScores, setSimulationScores] = useState<Record<string, number>>({});
  const [navigation, setNavigation] = useState<{ previousLesson: LessonNavigationItem | null; nextLesson: LessonNavigationItem | null }>({
    previousLesson: null,
    nextLesson: null,
  });
  const [objectivesOpen, setObjectivesOpen] = useState(false);
  const [activeLexicon, setActiveLexicon] = useState<number | null>(0);
  const [executionVisible, setExecutionVisible] = useState(false);

  const progressPercent = useMemo(() => {
    if (!lesson || lesson.quizzes.length === 0) {
      return 100;
    }

    const answered = lesson.quizzes.filter((quiz) => quizResults[quiz.id]).length;
    return Math.round((answered / lesson.quizzes.length) * 100);
  }, [lesson, quizResults]);

  const structured = useMemo<LessonExperience | null>(() => {
    if (!lesson) {
      return null;
    }

    return parseLessonExperience(lesson.body, lesson.title);
  }, [lesson]);

  const experience = useMemo<LessonExperience>(() => {
    if (structured) {
      return structured;
    }

    if (!lesson) {
      return createDefaultLessonExperience('Lesson');
    }

    const fallback = createDefaultLessonExperience(lesson.title);
    fallback.introduction = lesson.body ?? '';
    return fallback;
  }, [lesson, structured]);

  useEffect(() => {
    async function loadLesson(): Promise<void> {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/learning/lessons/get?id=${lessonId}`);
        const payload = (await response.json()) as {
          lesson?: LessonDetail;
          navigation?: { previousLesson?: LessonNavigationItem | null; nextLesson?: LessonNavigationItem | null };
          message?: string;
        };
        if (!response.ok || !payload.lesson) {
          throw new Error(payload.message ?? 'Failed to load lesson.');
        }

        setLesson(payload.lesson);
        setNavigation({
          previousLesson: payload.navigation?.previousLesson ?? null,
          nextLesson: payload.navigation?.nextLesson ?? null,
        });

        await fetch('/api/learning/progress/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            learnerKey: learnerKey(),
            lessonId,
            completed: false,
            percent: 5,
          }),
        });
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load lesson.');
      } finally {
        setLoading(false);
      }
    }

    void loadLesson();
  }, [lessonId]);

  useEffect(() => {
    if (!lesson) {
      return;
    }

    const key = `learning_objectives_seen_${lesson.id}`;
    const seen = typeof window !== 'undefined' ? window.localStorage.getItem(key) : '1';
    const shouldOpen = !seen;
    setObjectivesOpen(shouldOpen);
    if (!seen && typeof window !== 'undefined') {
      window.localStorage.setItem(key, '1');
    }

    setExecutionVisible(false);
    setActiveLexicon(0);
  }, [lesson]);

  async function submitQuiz(quiz: LessonQuiz): Promise<void> {
    const selected = quizSelections[quiz.id];
    if (selected === undefined) {
      return;
    }

    const response = await fetch('/api/learning/quizzes/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quizId: quiz.id, selected }),
    });

    const payload = (await response.json()) as {
      correct: boolean;
      answer: number;
      selectedExplanation?: string | null;
      correctExplanation?: string | null;
      message?: string;
    };
    if (!response.ok) {
      setError(payload.message ?? 'Unable to submit quiz answer.');
      return;
    }

    setQuizResults((current) => ({
      ...current,
      [quiz.id]: {
        quizId: quiz.id,
        correct: payload.correct,
        answer: payload.answer,
        selectedExplanation: payload.selectedExplanation ?? null,
        correctExplanation: payload.correctExplanation ?? null,
      },
    }));

    const nextCorrectCount = Object.values({
      ...quizResults,
      [quiz.id]: {
        quizId: quiz.id,
        correct: payload.correct,
        answer: payload.answer,
        selectedExplanation: payload.selectedExplanation ?? null,
        correctExplanation: payload.correctExplanation ?? null,
      },
    }).filter((result) => result.correct).length;

    const nextPercent = lesson && lesson.quizzes.length > 0
      ? Math.round((Object.keys({ ...quizResults, [quiz.id]: payload }).length / lesson.quizzes.length) * 100)
      : 100;

    await fetch('/api/learning/progress/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        learnerKey: learnerKey(),
        lessonId,
        completed: nextPercent === 100,
        percent: nextPercent,
        score: lesson && lesson.quizzes.length > 0 ? Math.round((nextCorrectCount / lesson.quizzes.length) * 100) : 100,
      }),
    });
  }

  async function markComplete(): Promise<void> {
    setCompleting(true);
    setError(null);

    try {
      await fetch('/api/learning/progress/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          learnerKey: learnerKey(),
          lessonId,
          completed: true,
          percent: 100,
          score: lesson && lesson.quizzes.length > 0
            ? Math.round((Object.values(quizResults).filter((result) => result.correct).length / lesson.quizzes.length) * 100)
            : 100,
        }),
      });
    } finally {
      setCompleting(false);
    }
  }

  function evaluateSimulation(blockId: string): void {
    const answer = (simulationAnswers[blockId] ?? '').toLowerCase();
    const rubricKeywords = [
      'coverage',
      'exclusion',
      'occurrence',
      'resulting damage',
      'economic loss',
      'ai',
      'indemnity',
      '32-1159',
      'cg 20 10',
      'cg 20 37',
      'cg 20 01',
    ];

    const matched = rubricKeywords.filter((keyword) => answer.includes(keyword)).length;
    const score = Math.min(100, Math.round((matched / 6) * 100));
    setSimulationScores((current) => ({ ...current, [blockId]: score }));
  }

  function goToLesson(targetLessonId: string): void {
    window.location.href = `/learning/lesson/${targetLessonId}?lessonId=${targetLessonId}`;
  }

  if (loading) {
    return <div className="rounded-lg border border-[#c8ced3] bg-white p-6 text-sm text-[#514f4d]">Loading lesson...</div>;
  }

  if (error || !lesson) {
    return <div className="rounded-lg border border-[#c8ced3] bg-white p-6 text-sm text-[#a61b1b]">{error ?? 'Lesson unavailable.'}</div>;
  }

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm"
      >
        <p className="text-xs uppercase tracking-wide text-[#706e6b]">{lesson.module.course.title} / {lesson.module.title}</p>
        <h2 className="mt-1 text-xl font-bold text-[#23282c]">{experience.meta.title || lesson.title}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#4b5563]">
          <span className="rounded-full bg-[#eef2ff] px-2 py-0.5 font-semibold text-[#1f3f77]">{experience.meta.difficulty}</span>
          <span>{experience.meta.readingTimeMinutes} min read</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href="/learning" className="rounded-md border border-[#c8ced3] px-3 py-1 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Exit to Learning Center</a>
          <a href={`/learning/course-builder/${lesson.module.course.id}`} className="rounded-md border border-[#c8ced3] px-3 py-1 text-xs font-semibold text-[#23282c] hover:bg-[#f0f3f5]">Open Course in Studio</a>
          {navigation.previousLesson ? (
            <button
              type="button"
              onClick={() => goToLesson(navigation.previousLesson!.id)}
              className="rounded-md border border-[#167495] px-3 py-1 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff]"
            >
              Back: {navigation.previousLesson.title}
            </button>
          ) : null}
          {navigation.nextLesson ? (
            <button
              type="button"
              onClick={() => goToLesson(navigation.nextLesson!.id)}
              className="rounded-md bg-[#167495] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0c4e8a]"
            >
              Next: {navigation.nextLesson.title}
            </button>
          ) : null}
        </div>
      </motion.div>

      {experience.introduction ? (
        <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <p className="text-sm leading-7 text-[#1f2937]">{experience.introduction}</p>
        </section>
      ) : null}

      <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
        <button
          type="button"
          onClick={() => setObjectivesOpen((current) => !current)}
          className="flex w-full items-center justify-between rounded-md border border-[#d5d8de] bg-[#f8fafc] px-3 py-2 text-sm font-semibold text-[#0f172a]"
        >
          <span>View Learning Objectives</span>
          <span>{objectivesOpen ? 'Hide' : 'Show'}</span>
        </button>

        <AnimatePresence initial={false}>
          {objectivesOpen ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.24, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <ol className="mt-3 space-y-2">
                {experience.learningObjectives.map((objective, index) => (
                  <li key={`${objective}-${index}`} className="rounded-md border border-[#e5e7eb] bg-[#ffffff] p-3 text-sm leading-6 text-[#111827]">
                    <span className="mr-2 font-semibold text-[#1d4ed8]">{index + 1}.</span>
                    {objective}
                  </li>
                ))}
              </ol>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </section>

      {experience.lexicon.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[#23282c]">Lexicon Board</h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {experience.lexicon.map((item, index) => {
              const active = activeLexicon === index;
              return (
                <button
                  key={item.term}
                  type="button"
                  onClick={() => setActiveLexicon(index)}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-[#167495] bg-[#f3f8ff]'
                      : 'border-[#e5e7eb] bg-white hover:border-[#bfd3f2]'
                  }`}
                >
                  <p className="text-sm font-semibold text-[#111827]">{item.term}</p>
                  <AnimatePresence initial={false}>
                    {active ? (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.2, ease: 'easeOut' }}
                        className="mt-1 text-xs leading-5 text-[#374151]"
                      >
                        {item.definition}
                      </motion.p>
                    ) : null}
                  </AnimatePresence>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {(experience.technicalDeepDive.heading || experience.technicalDeepDive.coreDoctrine || experience.technicalDeepDive.scenarios.length > 0) ? (
        <section className="space-y-3 rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <h3 className="text-base font-bold text-[#0f172a]">{experience.technicalDeepDive.heading || 'Technical Deep Dive'}</h3>
          {experience.technicalDeepDive.caseLawCitation ? (
            <p className="text-xs font-semibold text-[#334155]">{experience.technicalDeepDive.caseLawCitation}</p>
          ) : null}
          {experience.technicalDeepDive.coreDoctrine ? (
            <p className="rounded-md border border-[#dbeafe] bg-[#f8f9fa] p-3 text-sm leading-6 text-[#1f2937]">{experience.technicalDeepDive.coreDoctrine}</p>
          ) : null}

          {experience.technicalDeepDive.scenarios.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {experience.technicalDeepDive.scenarios.map((scenario) => (
                <article key={scenario.type} className="rounded-lg border border-[#e5e7eb] bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#475569]">{scenario.type}</p>
                  <p className="mt-1 text-sm leading-6 text-[#111827]">{scenario.description}</p>
                </article>
              ))}
            </div>
          ) : null}

          {!executionVisible ? (
            <button
              type="button"
              onClick={() => setExecutionVisible(true)}
              className="rounded-md border border-[#167495] px-3 py-1 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff]"
            >
              Next Step: Field Execution
            </button>
          ) : null}
        </section>
      ) : null}

      <AnimatePresence>
        {executionVisible && (experience.fieldExecution.strategyName || experience.fieldExecution.script) ? (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.26, ease: 'easeOut' }}
            className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm"
          >
            <h3 className="text-sm font-semibold text-[#23282c]">{experience.fieldExecution.strategyName || 'Field Execution'}</h3>
            {experience.fieldExecution.script ? (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#111827]">{experience.fieldExecution.script}</p>
            ) : null}
          </motion.section>
        ) : null}
      </AnimatePresence>

      {lesson.contentType === LearningContentType.VIDEO && lesson.contentUrl ? (
        <video className="w-full rounded-lg border border-[#c8ced3] bg-black" src={lesson.contentUrl} controls />
      ) : null}

      {lesson.contentType === LearningContentType.PDF && lesson.contentUrl ? (
        <iframe title="Lesson PDF" className="h-[640px] w-full rounded-lg border border-[#c8ced3] bg-white" src={lesson.contentUrl} />
      ) : null}

      {lesson.blocks.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[#23282c]">Applied Labs</h3>
          <AnimatePresence>
            {lesson.blocks.map((block, index) => {
            const content = asContentObject(block.content);
            const body = asString(content.body);
            const url = asString(content.url);

            return (
              <motion.article
                key={block.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25, delay: Math.min(index * 0.04, 0.24) }}
                className="rounded-md border border-[#e4e5e6] p-3"
              >
                <p className="text-xs uppercase tracking-wide text-[#706e6b]">{blockTypeLabels[block.type]}</p>
                <h4 className="text-sm font-semibold text-[#23282c]">{block.title ?? 'Untitled block'}</h4>

                {block.type === 'CODE' ? (
                  <pre className="mt-2 overflow-x-auto rounded bg-[#081a30] p-3 text-xs text-[#e5edf8]">{body || '// Add code snippet in Course Builder block editor.'}</pre>
                ) : null}

                {(block.type === 'TEXT' || block.type === 'EXERCISE' || block.type === 'SIMULATION' || block.type === 'QUIZ') ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[#181818]">{body || 'No text provided for this block yet.'}</p>
                ) : null}

                {block.type === 'SIMULATION' ? (
                  <div className="mt-3 rounded border border-[#d7e4f4] bg-[#f5f9ff] p-3">
                    <p className="text-xs font-semibold text-[#234067]">Your Analysis</p>
                    <textarea
                      className="mt-2 h-24 w-full rounded border border-[#c3d6ec] px-2 py-1 text-xs"
                      placeholder="Write your coverage position, exclusion analysis, and transfer strategy."
                      value={simulationAnswers[block.id] ?? ''}
                      onChange={(event) => {
                        setSimulationAnswers((current) => ({
                          ...current,
                          [block.id]: event.target.value,
                        }));
                      }}
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => evaluateSimulation(block.id)}
                        className="rounded border border-[#167495] px-2.5 py-1 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff]"
                      >
                        Evaluate Response
                      </button>
                      {simulationScores[block.id] !== undefined ? (
                        <span className="text-xs font-semibold text-[#167495]">Simulation score: {simulationScores[block.id]}%</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {block.type === 'VIDEO' && url ? (
                  <video className="mt-2 w-full rounded border border-[#c8ced3] bg-black" controls src={url} />
                ) : null}

                {block.type === 'PDF' && url ? (
                  <iframe title={`PDF block ${block.id}`} className="mt-2 h-[420px] w-full rounded border border-[#c8ced3]" src={url} />
                ) : null}
              </motion.article>
            );
            })}
          </AnimatePresence>
        </section>
      ) : null}

      {lesson.quizzes.length > 0 ? (
        <section className="space-y-3 rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-[#23282c]">Knowledge Checks</h3>
          {lesson.quizzes.map((quiz) => {
            const result = quizResults[quiz.id];
            const options = normalizeQuizOptions(quiz.options);

            return (
              <div key={quiz.id} className="rounded-md border border-[#e4e5e6] p-3">
                <p className="text-sm font-medium text-[#181818]">{quiz.question}</p>
                <div className="mt-2 space-y-2">
                  {options.map((option, index) => (
                    <button
                      key={`${quiz.id}-${index}`}
                      type="button"
                      onClick={() => {
                        setQuizSelections((current) => ({ ...current, [quiz.id]: index }));
                      }}
                      className={`w-full rounded-md border px-3 py-2 text-left text-xs transition-colors duration-200 ${
                        result
                          ? (index === result.answer
                            ? 'border-[#2f855a] bg-[#effcf2] text-[#14532d]'
                            : (quizSelections[quiz.id] === index
                              ? 'border-[#d97706] bg-[#fff7ed] text-[#7c2d12]'
                              : 'border-[#e5e7eb] bg-white text-[#1f2937]'))
                          : (quizSelections[quiz.id] === index
                            ? 'border-[#167495] bg-[#eef5ff] text-[#0c4e8a]'
                            : 'border-[#e5e7eb] bg-white text-[#1f2937] hover:border-[#bfd3f2]')
                      }`}
                    >
                      {option.text}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      void submitQuiz(quiz);
                    }}
                    className="rounded-md border border-[#167495] px-3 py-1 text-xs font-semibold text-[#167495] hover:bg-[#eef5ff]"
                  >
                    Submit
                  </button>
                  {result ? (
                    <div className="space-y-1">
                      <p className={`text-xs font-medium ${result.correct ? 'text-[#0a7d35]' : 'text-[#a61b1b]'}`}>
                        {result.correct ? 'Correct' : `Not quite. Correct option is #${result.answer + 1}.`}
                      </p>
                      {result.selectedExplanation ? (
                        <p className="text-xs text-[#334155]">Your answer note: {result.selectedExplanation}</p>
                      ) : null}
                      {!result.correct && result.correctExplanation ? (
                        <p className="text-xs text-[#167495]">Correct answer note: {result.correctExplanation}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </section>
      ) : null}

      <section className="rounded-lg border border-[#c8ced3] bg-white p-4 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#23282c]">Progress</h3>
          <span className="text-xs font-semibold text-[#167495]">{progressPercent}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-[#e4e5e6]">
          <div className="h-2 rounded-full bg-[#167495]" style={{ width: `${progressPercent}%` }} />
        </div>
        <button
          type="button"
          disabled={completing}
          onClick={() => {
            void markComplete();
          }}
          className="mt-3 rounded-md bg-[#23282c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#133a6b] disabled:opacity-60"
        >
          {completing ? 'Saving...' : 'Mark lesson complete'}
        </button>
      </section>
    </div>
  );
}
