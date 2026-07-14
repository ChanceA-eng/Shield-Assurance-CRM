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
    prompt: 'Tools are stolen from a locked job box overnight. Which coverage concept is most relevant?',
    options: [
      { key: 'A', text: 'Inland marine support for jobsite property and mobile assets' },
      { key: 'B', text: 'Workers compensation' },
      { key: 'C', text: 'CGL completed operations' },
    ],
    answer: 'A',
    explanation: 'Inland marine is the central property framework for contractor tools and jobsite-staged mobile assets.',
  },
  {
    id: 2,
    prompt: 'A contractor says, "My standard property form covers materials everywhere." What is the best response?',
    options: [
      { key: 'A', text: 'Correct, location does not affect property coverage' },
      { key: 'B', text: 'Materials in staging, transit, and pre-installation often require inland marine structure' },
      { key: 'C', text: 'CGL fills all property gaps automatically' },
    ],
    answer: 'B',
    explanation: 'Material location and movement conditions are critical; inland marine commonly fills these operational gaps.',
  },
  {
    id: 3,
    prompt: 'A rented compressor is damaged and the rental company demands payment. Which positioning is correct?',
    options: [
      { key: 'A', text: 'CGL should absorb the rental repayment demand' },
      { key: 'B', text: 'Inland marine with rented or borrowed equipment support addresses this exposure' },
      { key: 'C', text: 'No insurance concept applies to rented equipment obligations' },
    ],
    answer: 'B',
    explanation: 'Rented and borrowed equipment obligations are a core inland marine conversation in contractor accounts.',
  },
];

export default function ModuleSevenLessonFourPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 7 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 7</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Field Positioning and Contractor Scripts</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            This lesson converts technical coverage points into practical contractor-facing language.
            The objective is to improve decision quality under pressure: theft events, project delays,
            and confusion about what standard property forms actually cover.
          </p>
          <p className="leading-relaxed text-slate-700">
            You will use structured scripts, objection handling, and scenario framing to make property risk conversations clear.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Contractor Property Coverage Conversation Playbook]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Five Common Myths</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Myth 1:</strong> Standard property covers tools in trucks and trailers automatically.</li>
            <li><strong>Myth 2:</strong> Materials on jobsites are always covered before installation.</li>
            <li><strong>Myth 3:</strong> Rental company insurance is always sufficient.</li>
            <li><strong>Myth 4:</strong> CGL can fill most property loss gaps.</li>
            <li><strong>Myth 5:</strong> Theft control alone replaces insurance planning.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Your project depends on tools, equipment, and staged materials. Standard property does not always follow those assets
            through movement, storage, and pre-install windows. Inland marine protects the property conditions you actually operate in.
          </blockquote>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Scenario-Specific Scripts</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Truck-stored tools:</strong> If they stay mobile, inland marine strategy is non-negotiable.</li>
            <li><strong>Jobsite materials:</strong> Pre-install materials are project capital, not passive inventory.</li>
            <li><strong>Rental equipment:</strong> You can owe full repayment even when loss seems accidental.</li>
            <li><strong>Transit-heavy crews:</strong> Every transfer between sites creates concentrated property exposure.</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Objection Handling</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li><strong>Objection:</strong> We have never had a major theft. <strong>Response:</strong> Frequency is uncertain; one event can still stop production.</li>
            <li><strong>Objection:</strong> Property policy should handle this. <strong>Response:</strong> Movement and pre-install conditions are where inland marine becomes critical.</li>
            <li><strong>Objection:</strong> Rental coverage is enough. <strong>Response:</strong> Contract terms and limits often leave material repayment exposure.</li>
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
          <a href="/learning/module/7/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/7/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Proceed to Module Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
