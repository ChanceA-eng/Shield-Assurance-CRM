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
    prompt: 'What is the strongest opening framing for BOP vs CPP in contractor conversations?',
    options: [
      { key: 'A', text: 'Fit-first based on operation complexity and risk profile' },
      { key: 'B', text: 'Price-first without discussing exposure structure' },
      { key: 'C', text: 'Policy form names only with no context' },
    ],
    answer: 'A',
    explanation: 'Fit-first framing builds trust and aligns structure with actual operational risk before pricing detail.',
  },
  {
    id: 2,
    prompt: 'Which script element helps reduce objections during CPP recommendations?',
    options: [
      { key: 'A', text: 'Explain how modular design supports contract obligations and growth' },
      { key: 'B', text: 'Avoid discussing endorsements entirely' },
      { key: 'C', text: 'Assume all exclusions are acceptable to the client' },
    ],
    answer: 'A',
    explanation: 'Connecting structure to contracts and future growth improves acceptance of CPP architecture.',
  },
  {
    id: 3,
    prompt: 'What should be emphasized when a contractor is close to BOP limits?',
    options: [
      { key: 'A', text: 'Transition planning to prevent coverage disruption as complexity increases' },
      { key: 'B', text: 'Delay discussion until after a claim' },
      { key: 'C', text: 'Ignore future expansion indicators' },
    ],
    answer: 'A',
    explanation: 'Proactive transition planning avoids renewal shock and protects continuity as exposures evolve.',
  },
];

export default function ModuleNineLessonFourPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 9 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contractor Scripts</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Technical knowledge only drives results when it is communicated clearly. This lesson provides practical scripts
            for framing BOP versus CPP choices in language contractors trust.
          </p>
          <p className="leading-relaxed text-slate-700">
            The objective is to connect policy architecture to business reality: contracts, cash flow, claims volatility,
            and growth trajectory.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Agent-Client Coverage Discussion - BOP to CPP Transition]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Conversation Framework</h2>
          <ol className="list-decimal space-y-3 pl-5 text-base text-slate-700">
            <li>Start with operation profile and project complexity.</li>
            <li>Map top risk scenarios and contract obligations.</li>
            <li>Show how BOP or CPP structure handles those scenarios.</li>
            <li>Discuss growth trajectory and near-term expansion triggers.</li>
            <li>Present recommendation as continuity and adequacy strategy.</li>
          </ol>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Script Examples</h2>
          <div className="space-y-5 text-slate-700">
            <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
              For your current size and hazard profile, BOP can be efficient and cost-conscious while still protecting core exposure.
            </blockquote>
            <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
              Because your contracts and project mix are becoming more complex, CPP gives us the modular control needed to avoid
              coverage gaps and support long-term growth.
            </blockquote>
            <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
              We are not just comparing prices. We are choosing the structure that stays reliable when your operation scales or loss conditions change.
            </blockquote>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Objection Handling</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>
              Objection: CPP seems complicated.
              Response: Complexity in policy design can reduce complexity at claim time when exposures are actually layered.
            </li>
            <li>
              Objection: BOP looks cheaper.
              Response: Lower upfront premium can become costly if structure does not fit contract and hazard demands.
            </li>
            <li>
              Objection: We can revisit later.
              Response: Early transition planning prevents renewal disruption and preserves negotiating leverage.
            </li>
          </ul>
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
          <a href="/learning/module/9/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/9/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Take Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
