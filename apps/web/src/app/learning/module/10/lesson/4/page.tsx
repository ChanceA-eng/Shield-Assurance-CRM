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
    prompt: 'Which statement about trailer coverage is most accurate?',
    options: [
      { key: 'A', text: 'Trailer liability and trailer physical damage do not always move together' },
      { key: 'B', text: 'Trailer physical damage is always automatic with liability' },
      { key: 'C', text: 'Trailers are always covered under inland marine only' },
    ],
    answer: 'A',
    explanation: 'Trailer liability and trailer physical damage are often handled differently and must be validated.',
  },
  {
    id: 2,
    prompt: 'Hired auto physical damage is primarily intended to protect:',
    options: [
      { key: 'A', text: 'Rented vehicles against collision and comprehensive causes where configured' },
      { key: 'B', text: 'Employee-owned vehicles only' },
      { key: 'C', text: 'Only tools and cargo in detached trailers' },
    ],
    answer: 'A',
    explanation: 'Hired auto physical damage treatment addresses damage to rented units, not just liability exposure.',
  },
  {
    id: 3,
    prompt: 'Tools stolen from inside a trailer are most often evaluated under:',
    options: [
      { key: 'A', text: 'Inland marine/equipment structure rather than auto liability' },
      { key: 'B', text: 'Only auto liability' },
      { key: 'C', text: 'HNOA by default' },
    ],
    answer: 'A',
    explanation: 'Tools/equipment in transit are commonly addressed under inland marine, not auto liability.',
  },
];

export default function ModuleTenLessonFourPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 10 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Endorsements, Trailers, and Contractor-Specific Exposures</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Contractors regularly encounter trailer, rental, and loaner exposures that are misunderstood at placement time.
            This lesson explains where endorsements are needed and where assumptions create avoidable gaps.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Trailer and Endorsement Coverage Diagram]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why Endorsements Matter</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Trailer physical damage is frequently misunderstood and not automatically aligned</li>
            <li>Rented vehicle liability and rented vehicle physical damage can be split in treatment</li>
            <li>Loaner vehicle handling varies by form and carrier-specific terms</li>
            <li>Tools and attached equipment often require inland marine coordination</li>
            <li>Temporary substitute and leased-unit language can affect trigger certainty</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Key Endorsement Areas</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Trailer physical damage schedule/endorsement validation</li>
            <li>Hired auto physical damage treatment for rented vehicles</li>
            <li>Loaner and temporary substitute language alignment</li>
            <li>Additional insured/lessor requirements for leased fleets</li>
            <li>Drive other car and executive-use gap checks where relevant</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Aon and Verisk reporting continue to highlight trailer and towed-equipment involvement</li>
            <li>AM Best trend commentary ties claim outcomes to endorsement quality and gap controls</li>
            <li>Marsh casualty observations note loaner/rental complexity in loss investigations</li>
            <li>Industry theft reporting continues to show pressure on equipment-in-transit exposures</li>
            <li>Rental utilization data reinforces need for clear hired auto treatment</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Scenarios</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Trailer theft from jobsite with no trailer physical damage endorsement in place</li>
            <li>Rented truck collision where liability applies but rented unit damage is disputed</li>
            <li>Loaner accident during repair period with unclear temporary substitute language</li>
            <li>Tool theft from trailer requiring inland marine coordination, not auto liability only</li>
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
          <a href="/learning/module/10/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/10/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Take Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
