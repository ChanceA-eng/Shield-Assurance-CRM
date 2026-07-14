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
    prompt: 'Theft of installed copper occurs during construction. Which coverage concept is primary?',
    options: [
      { key: 'A', text: "Builder's Risk covered property response" },
      { key: 'B', text: 'Workers compensation' },
      { key: 'C', text: 'Auto liability' },
    ],
    answer: 'A',
    explanation: "Builder's Risk is intended for project property and installed components during construction phases.",
  },
  {
    id: 2,
    prompt: 'Which exclusion frequently needs separate endorsement in many Builder\'s Risk structures?',
    options: [
      { key: 'A', text: 'Fire' },
      { key: 'B', text: 'Flood or earthquake, depending on form and location' },
      { key: 'C', text: 'All theft without exception' },
    ],
    answer: 'B',
    explanation: 'Flood and earthquake are commonly excluded or limited and may require project-specific endorsement.',
  },
  {
    id: 3,
    prompt: 'What best describes covered causes of loss in many special-form Builder\'s Risk policies?',
    options: [
      { key: 'A', text: 'Named-peril fire only' },
      { key: 'B', text: 'Broad all-risk style approach subject to specific exclusions and conditions' },
      { key: 'C', text: 'Only liability-triggered causes' },
    ],
    answer: 'B',
    explanation: 'Many forms are broad special-form style but still controlled by exclusions, sublimits, and terms.',
  },
];

export default function ModuleEightLessonTwoPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 8 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 8</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Covered Property and Covered Causes of Loss</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            This lesson maps what Builder's Risk is intended to cover: structure, staged materials, temporary works,
            and installed components during project build phases.
          </p>
          <p className="leading-relaxed text-slate-700">
            It also explains common exclusion boundaries and the role of endorsements for catastrophe and specialized conditions.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Covered Property and Causes - Structure, Transit, Temporary Works]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Covered Property Focus</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Structure under construction and partially completed work</li>
            <li>On-site materials awaiting installation</li>
            <li>Installed building components during project term</li>
            <li>Scheduled temporary structures and related project property</li>
            <li>Debris removal support after covered events</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Covered Causes and Exclusion Boundaries</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Special-form frameworks are broad but never unlimited. Read exclusions and sublimits closely,
            especially where flood, earthquake, testing, defect-related loss, and ordinance impacts are involved.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Common covered drivers: fire, theft, weather, water damage, accidental physical loss</li>
            <li>Common excluded or restricted drivers: flood, earthquake, wear and tear, defect carve-outs</li>
            <li>Resulting damage treatment varies by wording and jurisdiction</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Cited Research Signals</h2>
          <p className="leading-relaxed text-slate-700">
            Market commentary from NFPA, Marsh, Aon, PCS/Verisk, AGC, and Dodge consistently highlights fire,
            weather, water, theft, and delay as major construction loss drivers. Use these sources to support practical risk conversations.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Builder's Risk is broad, but not automatic for everything. We protect the project first,
            then close known exclusion gaps with targeted endorsements.
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
          <a href="/learning/module/8/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/8/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
