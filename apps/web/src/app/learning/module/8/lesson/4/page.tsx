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
    prompt: 'A contractor says: "Standard property covers buildings under construction." Best response?',
    options: [
      { key: 'A', text: 'Correct, no project-specific policy is required' },
      { key: 'B', text: "Builder's Risk is designed for construction-phase project property and should be verified by contract" },
      { key: 'C', text: 'CGL is the primary construction property form' },
    ],
    answer: 'B',
    explanation: "Builder's Risk exists specifically for project property during construction phases.",
  },
  {
    id: 2,
    prompt: 'Which framing is strongest when discussing cost objections?',
    options: [
      { key: 'A', text: 'Compare premium against potential six-figure physical and delay loss exposure' },
      { key: 'B', text: 'Ignore loss data and rely on generic reassurance' },
      { key: 'C', text: 'Present only legal contract language without examples' },
    ],
    answer: 'A',
    explanation: 'Risk conversation improves when cost is compared to realistic loss severity and restart expense.',
  },
  {
    id: 3,
    prompt: 'What is the most accurate statement for lender-required projects?',
    options: [
      { key: 'A', text: 'Lenders often require project property protection because unfinished collateral is exposed' },
      { key: 'B', text: 'Lenders typically prohibit Builder\'s Risk' },
      { key: 'C', text: 'Lenders require workers compensation instead of project property coverage' },
    ],
    answer: 'A',
    explanation: 'Lender requirements are tied to collateral protection during vulnerable construction phases.',
  },
];

export default function ModuleEightLessonFourPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 8 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 8</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contractor Scripts</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            This lesson focuses on how to explain Builder's Risk in real contractor conversations.
            The best positioning combines plain language, contract responsibility clarity, and evidence-based loss context.
          </p>
          <p className="leading-relaxed text-slate-700">
            Effective communication here reduces uninsured project assumptions before a major event forces correction.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Builder's Risk Field Conversation and Objection Handling]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Common Misunderstandings</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Assuming owner, GC, or sub responsibility without checking contract language</li>
            <li>Treating standard property as a full construction-phase replacement</li>
            <li>Ignoring delay and soft-cost consequences after physical damage</li>
            <li>Underestimating theft, fire, weather, and water loss frequency</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Builder's Risk protects invested project value before completion. It is not tool coverage and not a substitute for inland marine.
            It is project property protection for construction-phase loss reality.
          </blockquote>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Scenario Scripts</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Cost objection:</strong> Compare premium with reconstruction, delay, and carrying-cost impact.</li>
            <li><strong>Responsibility confusion:</strong> Pull contract language and confirm purchaser and named interests.</li>
            <li><strong>Coverage overlap concern:</strong> Clarify Builder's Risk for project property and inland marine for contractor mobile tools/equipment.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Cited Research Signals to Use</h2>
          <p className="leading-relaxed text-slate-700">
            Refer to NFPA construction fire reporting, AGC theft indicators, PCS/Verisk claim-driver patterns,
            and market updates from Marsh and Aon when reinforcing severity and underwriting realities.
          </p>
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
          <a href="/learning/module/8/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/8/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Proceed to Module Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
