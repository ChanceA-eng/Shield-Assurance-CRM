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
    prompt: 'A fire destroys framing and staged materials. Which policy concept is central?',
    options: [
      { key: 'A', text: "Builder's Risk" },
      { key: 'B', text: 'Workers compensation' },
      { key: 'C', text: 'CGL personal injury coverage' },
    ],
    answer: 'A',
    explanation: "Builder's Risk is the core construction-phase property response for project structure and staged materials.",
  },
  {
    id: 2,
    prompt: 'Who always buys Builder\'s Risk on every project?',
    options: [
      { key: 'A', text: 'The subcontractor in all cases' },
      { key: 'B', text: 'The owner in all cases' },
      { key: 'C', text: 'It depends on contract allocation among owner, GC, and project requirements' },
    ],
    answer: 'C',
    explanation: 'Purchase responsibility is contract-driven and must be verified in project documentation.',
  },
  {
    id: 3,
    prompt: 'Which condition is a frequent reason Builder\'s Risk is required by lenders?',
    options: [
      { key: 'A', text: 'Construction assets are exposed before completion and occupancy controls' },
      { key: 'B', text: 'It replaces professional liability' },
      { key: 'C', text: 'It replaces inland marine for contractor tools' },
    ],
    answer: 'A',
    explanation: 'Lenders require protection of in-progress collateral exposed to fire, theft, weather, and water loss.',
  },
];

export default function ModuleEightLessonOnePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 8 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 8</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Builder's Risk Basics</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Builder's Risk covers project property during construction, renovation, or major installation.
            It protects work in progress and staged materials where completed-building policies do not apply.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson introduces core coverage intent, contracting responsibility, and data-backed loss context used in real field discussions.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Builder's Risk Basics - Structure, Materials, Work in Progress]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Builder's Risk Is Designed For</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Physical loss to structure under active construction</li>
            <li>Staged and installed material exposure before completion</li>
            <li>Temporary project conditions before standard occupancy controls</li>
            <li>Restart and cleanup pressure following covered events</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data and Research Signals for Positioning</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Industry studies from NFPA, Marsh, Aon, AGC, PCS/Verisk, and Dodge consistently show concentrated construction loss pressure
            from fire, weather, water, theft, and resulting delay cost. Use these sources to support credibility in advisory conversations.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NFPA fire trend reporting for structures under construction</li>
            <li>Marsh and Aon market updates on Builder's Risk severity and capacity</li>
            <li>AGC contractor theft and operating stress indicators</li>
            <li>PCS/Verisk claim-driver event summaries</li>
            <li>Dodge delay and project disruption trend reporting</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            During construction, your highest-value property is unfinished and exposed. Builder's Risk protects invested labor,
            material, and progress before completion when standard property assumptions do not fit.
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
          <a href="/learning/module/8" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/8/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
