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
    prompt: 'Which symbol provides the broadest liability trigger for contractor auto?',
    options: [
      { key: 'A', text: 'Symbol 1 (Any Auto)' },
      { key: 'B', text: 'Symbol 7 (Specifically Described Autos only)' },
      { key: 'C', text: 'Symbol 9 (Non-Owned Autos only)' },
    ],
    answer: 'A',
    explanation: 'Symbol 1 is the broad liability trigger and commonly used to reduce trigger failure risk.',
  },
  {
    id: 2,
    prompt: 'What is the key risk with Symbol 7?',
    options: [
      { key: 'A', text: 'New or unscheduled autos may have no coverage trigger if not added' },
      { key: 'B', text: 'It automatically includes all hired and non-owned exposures' },
      { key: 'C', text: 'It applies to trailers and inland marine by default' },
    ],
    answer: 'A',
    explanation: 'Symbol 7 is schedule-dependent. Missing schedule updates can produce no-trigger outcomes.',
  },
  {
    id: 3,
    prompt: 'Symbol 9 primarily activates coverage for:',
    options: [
      { key: 'A', text: 'Employee-owned autos used in business operations' },
      { key: 'B', text: 'Owned autos only' },
      { key: 'C', text: 'Rented autos physical damage automatically' },
    ],
    answer: 'A',
    explanation: 'Symbol 9 maps to non-owned auto exposure, usually employee-owned units in business use.',
  },
];

export default function ModuleTenLessonThreePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 10 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Auto Symbols and Coverage Triggers</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Auto symbols are coverage triggers. If the symbol on a line does not include the auto involved in loss,
            coverage may not apply even when the insured expects it to.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson focuses on the symbols contractors most often encounter and misinterpret: 1, 7, 8, and 9.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Auto Symbols 1, 7, 8, 9 Coverage Trigger Diagram]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Symbols Do</h2>
          <p className="leading-relaxed text-slate-700">
            Symbols are numeric scope definitions shown by coverage line. They determine what qualifies as a covered auto
            for that specific line. Symbol mismatch is a leading cause of denied expectations.
          </p>
          <div className="mt-4 rounded bg-slate-100 p-4 text-sm text-slate-800">
            Liability: Symbol 1 | Physical Damage: Symbol 7 | Hired: Symbol 8 | Non-Owned: Symbol 9
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Symbols for Contractors</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Symbol 1:</strong> Broad liability trigger for any auto</li>
            <li><strong>Symbol 7:</strong> Schedule-dependent coverage for specifically described autos</li>
            <li><strong>Symbol 8:</strong> Hired autos used in operations (typically liability context)</li>
            <li><strong>Symbol 9:</strong> Non-owned autos, often employee-owned units used in business</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Verisk reporting frequently cites schedule and trigger mismatch as a claims friction source</li>
            <li>Marsh and AM Best commentary links symbol design decisions to outcome variability</li>
            <li>Aon contractor studies highlight non-owned and hired exposure volume</li>
            <li>Rental utilization trends amplify Symbol 8 relevance in contractor programs</li>
            <li>Coverage trigger quality is a key underwriting and advisory competency marker</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Scenarios</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>New truck not added under Symbol 7 before loss: no trigger and no expected coverage</li>
            <li>Employee material pickup using personal auto: Symbol 9 pathway is critical</li>
            <li>Short-term rental van involved in accident: Symbol 8 scope controls liability response</li>
            <li>Broad liability design using Symbol 1 reduces trigger ambiguity across operations</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
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
          <a href="/learning/module/10/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/10/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
