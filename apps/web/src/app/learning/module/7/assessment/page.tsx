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
    prompt: 'Which scenario is commonly outside basic fixed-location property assumptions?',
    options: [
      { key: 'A', text: 'Tools stored in mobile vehicles and trailers' },
      { key: 'B', text: 'Office furniture at headquarters' },
      { key: 'C', text: 'Payroll records in accounting software' },
    ],
    answer: 'A',
  },
  {
    id: 2,
    prompt: 'Inland marine is primarily designed for:',
    options: [
      { key: 'A', text: 'Moving property: tools, equipment, and materials in transit or temporary storage' },
      { key: 'B', text: 'Employee injury wage replacement' },
      { key: 'C', text: 'Professional liability claims' },
    ],
    answer: 'A',
  },
  {
    id: 3,
    prompt: 'Materials staged at a jobsite before installation are best evaluated under which concept?',
    options: [
      { key: 'A', text: 'Inland marine support for pre-installation exposure' },
      { key: 'B', text: 'Workers compensation' },
      { key: 'C', text: 'Auto medical payments' },
    ],
    answer: 'A',
  },
  {
    id: 4,
    prompt: 'A contractor damages rented equipment and receives a repayment demand. Most relevant concept?',
    options: [
      { key: 'A', text: 'Inland marine with rented or borrowed equipment support' },
      { key: 'B', text: 'CGL personal and advertising injury' },
      { key: 'C', text: 'Workers compensation employer liability' },
    ],
    answer: 'A',
  },
  {
    id: 5,
    prompt: 'Tools are damaged while transported between jobsites. Which concept is central?',
    options: [
      { key: 'A', text: 'Inland marine transit coverage intent' },
      { key: 'B', text: 'Completed operations hazard' },
      { key: 'C', text: 'Employment practices liability' },
    ],
    answer: 'A',
  },
  {
    id: 6,
    prompt: 'Which of the following is a common excluded cause category in many property forms?',
    options: [
      { key: 'A', text: 'Wear and tear or gradual deterioration' },
      { key: 'B', text: 'All theft events without exception' },
      { key: 'C', text: 'All weather-related claims under every condition' },
    ],
    answer: 'A',
  },
  {
    id: 7,
    prompt: 'A job box break-in results in stolen tools and materials. Which coverage conversation is most relevant?',
    options: [
      { key: 'A', text: 'Inland marine jobsite property support' },
      { key: 'B', text: 'Workers compensation' },
      { key: 'C', text: 'Commercial auto hired liability' },
    ],
    answer: 'A',
  },
  {
    id: 8,
    prompt: 'Roofing materials are destroyed by weather before installation. Which concept applies?',
    options: [
      { key: 'A', text: 'Inland marine pre-installation material coverage intent' },
      { key: 'B', text: 'CGL contractual liability transfer' },
      { key: 'C', text: 'Auto physical damage only' },
    ],
    answer: 'A',
  },
  {
    id: 9,
    prompt: 'Which statement about inland marine is most accurate?',
    options: [
      { key: 'A', text: 'It is built for property that moves through transit, staging, and temporary storage conditions' },
      { key: 'B', text: 'It only covers office contents at fixed headquarters locations' },
      { key: 'C', text: 'It replaces workers compensation obligations' },
    ],
    answer: 'A',
  },
  {
    id: 10,
    prompt: 'A borrowed compressor is damaged during use. Which concept best fits the response discussion?',
    options: [
      { key: 'A', text: 'Inland marine with borrowed equipment support' },
      { key: 'B', text: 'CGL products-completed operations only' },
      { key: 'C', text: 'Workers compensation medical benefits' },
    ],
    answer: 'A',
  },
];

export default function ModuleSevenAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 7 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 7 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment verifies understanding of property coverage structure, inland marine exposure,
            tools and equipment movement risk, and jobsite material loss scenarios.
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
            <a href="/learning/module/7/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 7 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/7/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
