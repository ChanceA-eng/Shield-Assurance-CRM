'use client';

import { useState } from 'react';
import SectionLayout from '../../../../../../components/crm/SectionLayout';

type Choice = 'A' | 'B' | 'C';

type MiniQuestion = {
  id: number;
  prompt: string;
  options: Array<{ key: Choice; text: string }>;
  answer: Choice;
  explanation: string;
};

const miniQuestions: MiniQuestion[] = [
  {
    id: 1,
    prompt: 'A covered fire causes a three-month project delay and missed lease-up revenue. Which coverage concept is most relevant?',
    options: [
      { key: 'A', text: 'Delay-in-completion / delay in start-up style protection' },
      { key: 'B', text: 'Workers compensation' },
      { key: 'C', text: 'Auto liability' },
    ],
    answer: 'A',
    explanation: 'Delay coverage addresses qualifying financial impact from covered project delay events.',
  },
  {
    id: 2,
    prompt: 'Architectural rework fees, permit re-issuance, and added interest after a covered event are commonly grouped as:',
    options: [
      { key: 'A', text: 'Soft costs' },
      { key: 'B', text: 'General liability damages' },
      { key: 'C', text: 'Workers compensation medical costs' },
    ],
    answer: 'A',
    explanation: 'Soft costs are non-physical financial expenses incurred because a covered loss delays completion.',
  },
  {
    id: 3,
    prompt: 'Which statement is most accurate about endorsements?',
    options: [
      { key: 'A', text: 'They can expand coverage to specific exposures such as flood, quake, testing, or ordinance requirements' },
      { key: 'B', text: 'They remove all exclusions automatically' },
      { key: 'C', text: 'They only apply after project completion' },
    ],
    answer: 'A',
    explanation: 'Endorsements are targeted adjustments, not blanket elimination of policy conditions.',
  },
];

export default function ModuleEightLessonThreePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 8 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 8</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Soft Costs, Delay Coverage, and Endorsements</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Physical damage is only part of project loss. Schedule disruption can generate financing pressure,
            additional professional fees, and missed revenue windows.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains how soft cost and delay concepts are evaluated, plus how endorsements are used to align coverage with project risk profile.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Delay and Soft Cost Timeline - Event to Recovery to Reopen]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Soft Costs Include</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Architectural and engineering redesign expenses</li>
            <li>Permit, inspection, and administrative restart costs</li>
            <li>Extended financing interest and project overhead carry</li>
            <li>Tax and fee extensions tied to delayed completion</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Delay Coverage in Practice</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Delay-related protection is usually triggered by covered physical damage that shifts the completion date.
            Scope and waiting periods vary, so terms must match financing and occupancy realities.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Lost rental or business income windows</li>
            <li>Additional carrying costs during schedule recovery</li>
            <li>Extended general conditions and management expense</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Endorsement Strategy</h2>
          <p className="leading-relaxed text-slate-700">
            Project-specific endorsements often address flood, earthquake, testing, ordinance requirements,
            transit extensions, and debris or cleanup limits. Each endorsement should tie directly to documented project exposures.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Rebuild cost is only the first number. Delay and soft cost pressure can be just as damaging,
            so we structure coverage for both physical loss and schedule impact.
          </blockquote>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-sm font-bold uppercase tracking-wider text-slate-500">Knowledge Check</h2>

          <div className="space-y-8">
            {miniQuestions.map((question) => {
              const selectedAnswer = selected[question.id];
              const hasSelection = selectedAnswer !== undefined;
              const isCorrect = selectedAnswer === question.answer;

              return (
                <div key={question.id} className="space-y-3">
                  <p className="font-semibold text-slate-900">{question.id}. {question.prompt}</p>
                  <div className="space-y-2">
                    {question.options.map((option) => {
                      const isActive = selectedAnswer === option.key;
                      return (
                        <button
                          key={`${question.id}-${option.key}`}
                          type="button"
                          onClick={() => {
                            setSelected((current) => ({ ...current, [question.id]: option.key }));
                          }}
                          className={`w-full rounded border p-3 text-left text-sm transition ${isActive ? 'border-slate-700 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'}`}
                        >
                          {option.key}. {option.text}
                        </button>
                      );
                    })}
                  </div>

                  {hasSelection ? (
                    <div className="rounded border border-slate-100 bg-slate-50 p-4">
                      <p className={`mb-2 font-bold ${isCorrect ? 'text-emerald-700' : 'text-red-700'}`}>
                        {isCorrect ? 'Correct' : 'Incorrect'}
                      </p>
                      <p className="text-sm leading-relaxed text-slate-700">{question.explanation}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/8/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/8/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
