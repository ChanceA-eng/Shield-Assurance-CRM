'use client';

import { useMemo, useState } from 'react';
import SectionLayout from '../../../../../components/crm/SectionLayout';

type Choice = 'A' | 'B' | 'C';

type Question = {
  id: number;
  prompt: string;
  options: Array<{ key: Choice; text: string }>;
  answer: Choice;
};

const questions: Question[] = [
  {
    id: 1,
    prompt: "Builder's Risk is primarily designed to protect:",
    options: [
      { key: 'A', text: 'Project property under construction' },
      { key: 'B', text: 'Only employee injury exposure' },
      { key: 'C', text: 'Only professional liability loss' },
    ],
    answer: 'A',
  },
  {
    id: 2,
    prompt: 'A major framing fire occurs during active construction. Which concept is most relevant?',
    options: [
      { key: 'A', text: "Builder's Risk physical damage response" },
      { key: 'B', text: 'Workers compensation response only' },
      { key: 'C', text: 'Commercial auto liability' },
    ],
    answer: 'A',
  },
  {
    id: 3,
    prompt: 'Responsibility for buying Builder\'s Risk is typically determined by:',
    options: [
      { key: 'A', text: 'Project contract allocation' },
      { key: 'B', text: 'Subcontractor payroll size only' },
      { key: 'C', text: 'Workers compensation class code' },
    ],
    answer: 'A',
  },
  {
    id: 4,
    prompt: 'Which loss driver is repeatedly highlighted across construction property research?',
    options: [
      { key: 'A', text: 'Fire, theft, weather, and water damage' },
      { key: 'B', text: 'Cyber-only claim concentration' },
      { key: 'C', text: 'Marine cargo piracy only' },
    ],
    answer: 'A',
  },
  {
    id: 5,
    prompt: 'Soft costs are best described as:',
    options: [
      { key: 'A', text: 'Non-physical financial expenses caused by covered delay effects' },
      { key: 'B', text: 'Only repair material invoices' },
      { key: 'C', text: 'Only bodily injury settlements' },
    ],
    answer: 'A',
  },
  {
    id: 6,
    prompt: 'Delay-in-completion style protection is most associated with:',
    options: [
      { key: 'A', text: 'Revenue and carrying-cost impact from covered delay events' },
      { key: 'B', text: 'Vehicle collision replacement' },
      { key: 'C', text: 'General liability personal injury' },
    ],
    answer: 'A',
  },
  {
    id: 7,
    prompt: 'Which statement about endorsements is most accurate?',
    options: [
      { key: 'A', text: 'They can target specific exposures such as flood, quake, and testing conditions' },
      { key: 'B', text: 'They eliminate all exclusions automatically' },
      { key: 'C', text: 'They apply only after project closeout' },
    ],
    answer: 'A',
  },
  {
    id: 8,
    prompt: 'Which source set is commonly referenced for Builder\'s Risk trend context?',
    options: [
      { key: 'A', text: 'NFPA, Marsh, Aon, AGC, PCS/Verisk, and Dodge' },
      { key: 'B', text: 'Only vehicle registration records' },
      { key: 'C', text: 'Only social media polling' },
    ],
    answer: 'A',
  },
  {
    id: 9,
    prompt: 'A contractor says standard property always covers construction-phase project assets. Best response?',
    options: [
      { key: 'A', text: "Builder's Risk should be verified because construction-phase conditions differ from fixed completed-property assumptions" },
      { key: 'B', text: 'No project-specific review is needed' },
      { key: 'C', text: 'CGL automatically replaces project property forms' },
    ],
    answer: 'A',
  },
  {
    id: 10,
    prompt: 'Which module-end route follows successful assessment completion?',
    options: [
      { key: 'A', text: '/learning/module/8/complete' },
      { key: 'B', text: '/learning/module/8/lesson/1' },
      { key: 'C', text: '/learning/module/7/complete' },
    ],
    answer: 'A',
  },
];

export default function ModuleEightAssessmentPage(): JSX.Element {
  const [answers, setAnswers] = useState<Partial<Record<number, Choice>>>({});
  const [submitted, setSubmitted] = useState(false);

  const score = useMemo(() => {
    return questions.reduce((sum, question) => {
      return sum + (answers[question.id] === question.answer ? 1 : 0);
    }, 0);
  }, [answers]);

  const percent = Math.round((score / questions.length) * 100);
  const passed = percent >= 80;

  return (
    <SectionLayout title="Module 8 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 8 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment validates understanding of Builder's Risk structure, covered property,
            loss drivers, soft costs, delay implications, and positioning logic.
          </p>
        </header>

        <div className="space-y-8">
          {questions.map((question) => (
            <section key={question.id} className="space-y-3">
              <p className="font-semibold text-slate-900">{question.id}. {question.prompt}</p>
              <div className="space-y-2">
                {question.options.map((option) => {
                  const selected = answers[question.id] === option.key;
                  return (
                    <button
                      key={`${question.id}-${option.key}`}
                      type="button"
                      onClick={() => {
                        setAnswers((current) => ({ ...current, [question.id]: option.key }));
                      }}
                      className={`w-full rounded border p-3 text-left text-sm transition ${selected ? 'border-slate-700 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'}`}
                    >
                      {option.key}. {option.text}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="border-t border-slate-200 pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setSubmitted(true)}
              className="rounded-lg bg-slate-950 px-8 py-4 text-lg font-semibold text-white shadow-sm transition-all hover:bg-slate-800"
            >
              Submit Assessment
            </button>
            <a href="/learning/module/8/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 8 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/8/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
