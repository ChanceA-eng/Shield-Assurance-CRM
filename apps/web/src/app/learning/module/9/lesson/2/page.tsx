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
    prompt: 'What best defines a CPP structure?',
    options: [
      { key: 'A', text: 'Modular policy architecture combining selected coverage parts' },
      { key: 'B', text: 'Single-line workers compensation format' },
      { key: 'C', text: 'Auto-only fleet package' },
    ],
    answer: 'A',
    explanation: 'CPP allows selected coverage parts to be combined and configured based on operation profile.',
  },
  {
    id: 2,
    prompt: 'Which account profile most often needs CPP flexibility?',
    options: [
      { key: 'A', text: 'Higher-hazard or multi-state contractor with expanding specialty exposures' },
      { key: 'B', text: 'Very small, low-hazard operation with minimal property schedule' },
      { key: 'C', text: 'Sole proprietor with no commercial activity' },
    ],
    answer: 'A',
    explanation: 'CPP is typically used where BOP constraints limit needed customization and capacity.',
  },
  {
    id: 3,
    prompt: 'Which statement about CPP flexibility is most accurate?',
    options: [
      { key: 'A', text: 'Limits, endorsements, and line integration can be aligned to complex contractor exposures' },
      { key: 'B', text: 'CPP always reduces to fewer options than BOP' },
      { key: 'C', text: 'CPP excludes inland marine by definition' },
    ],
    answer: 'A',
    explanation: 'CPP strength is structured flexibility across line selection, limits, and endorsements.',
  },
];

export default function ModuleNineLessonTwoPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 9 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: CPP Structure and Flexibility</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Commercial Package Policy structure is designed for operations that need more than a fixed small-business bundle.
            It supports customized line selection, broader endorsement control, and larger-limit architecture.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains how CPP design supports growing contractor accounts and high-variance risk profiles.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: CPP Modular Structure - Coverage Parts and Endorsement Layers]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Coverage Parts Commonly Combined</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>General liability and property backbone</li>
            <li>Inland marine and contractor equipment structures</li>
            <li>Builder's Risk integration for project-dependent accounts</li>
            <li>Business income, crime, cyber, pollution, and specialty lines as needed</li>
            <li>Auto and umbrella architecture for broader liability towers</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Cited Market Signals</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Reporting from Marsh, Aon, AM Best, Deloitte, and Verisk continues to show strong middle-market package demand,
            rising contractor complexity, and increased need for customizable line coordination.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Middle-market package penetration remains substantial</li>
            <li>Contractor segment growth sustains specialty coverage demand</li>
            <li>Loss-trend pressure reinforces underwriting discipline and structure fit</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">When CPP Becomes Necessary</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Revenue and payroll exceed small-business eligibility guardrails</li>
            <li>Trade class hazard profile exceeds BOP appetite</li>
            <li>Geographic spread introduces broader jurisdictional variation</li>
            <li>Specialty endorsements become central, not optional</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            BOP works when risk is simple. CPP works when your operation is layered. We use CPP to align coverage parts
            with real contract demands, hazard profile, and growth trajectory.
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
          <a href="/learning/module/9/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/9/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
