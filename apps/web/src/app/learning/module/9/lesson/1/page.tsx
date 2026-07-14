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
    prompt: 'Which core bundle is most associated with a standard BOP design?',
    options: [
      { key: 'A', text: 'Liability, property, and business income foundation' },
      { key: 'B', text: 'Workers compensation and auto only' },
      { key: 'C', text: 'Pollution and professional liability only' },
    ],
    answer: 'A',
    explanation: 'BOP is typically a bundled package anchored on liability, property, and income interruption support.',
  },
  {
    id: 2,
    prompt: 'Which contractor profile is usually closer to BOP fit?',
    options: [
      { key: 'A', text: 'Smaller, lower-hazard operation with moderate revenue and straightforward exposure' },
      { key: 'B', text: 'Multi-state heavy industrial operation with complex high-hazard work' },
      { key: 'C', text: 'Steel erection account requiring specialized umbrella architecture' },
    ],
    answer: 'A',
    explanation: 'BOP fit generally favors smaller, lower-complexity exposure profiles under carrier eligibility thresholds.',
  },
  {
    id: 3,
    prompt: 'Which statement about BOP exclusions is most accurate?',
    options: [
      { key: 'A', text: 'Specialized construction exposures often require separate lines or transition toward CPP' },
      { key: 'B', text: 'BOP includes all contractor specialty lines by default' },
      { key: 'C', text: 'BOP replaces Builder\'s Risk and inland marine automatically' },
    ],
    answer: 'A',
    explanation: 'Builder\'s Risk, inland marine depth, and other specialty exposures are often outside default BOP scope.',
  },
];

export default function ModuleNineLessonOnePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 9 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: BOP Basics</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            A Business Owners Policy is a bundled structure commonly used for qualifying smaller contractor accounts.
            It emphasizes administrative efficiency, practical core protection, and straightforward renewal management.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains baseline components, typical fit thresholds, and common reasons contractors eventually transition to CPP.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: BOP Structure - Liability Property Business Income]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What BOP Usually Includes</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>General liability foundation for common third-party injury and damage allegations</li>
            <li>Commercial property support for scheduled business property interests</li>
            <li>Business income / interruption support linked to covered property loss conditions</li>
            <li>Carrier-defined optional endorsement menu for selected added risks</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data-Backed Context</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Industry reporting from AM Best, Aon, Marsh, Deloitte, and Verisk continues to show strong small-business package
            demand, contractor segment expansion, and rising pressure from combined property and liability loss trends.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Bundled placement growth in small-business segments</li>
            <li>Construction participation as a meaningful share of package business</li>
            <li>Administrative efficiency gains from bundled policy handling</li>
            <li>Loss trend pressure influencing eligibility and rating rigor</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Common Fit Indicators</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Moderate revenue profile under carrier-specific thresholds</li>
            <li>Lower hazard trade class and stable claims pattern</li>
            <li>Single-state or limited-territory operating footprint</li>
            <li>Manageable property schedules and limited specialty exposure</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            BOP works best when your operation is lean, lower hazard, and stable. It keeps core coverage efficient.
            As complexity rises, we transition to CPP so coverage structure can keep pace with real risk.
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
          <a href="/learning/module/9" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/9/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
