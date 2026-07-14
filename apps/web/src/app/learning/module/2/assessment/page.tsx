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
    prompt: 'Coverage A responds only when the loss involves:',
    options: [
      { key: 'A', text: 'Bodily injury or property damage' },
      { key: 'B', text: 'Economic loss only' },
      { key: 'C', text: 'Contractual disputes only' },
    ],
    answer: 'A',
  },
  {
    id: 2,
    prompt: 'Faulty workmanship itself is generally:',
    options: [
      { key: 'A', text: 'Covered under Coverage A' },
      { key: 'B', text: 'Excluded as a business risk' },
      { key: 'C', text: 'Covered under Coverage B' },
    ],
    answer: 'B',
  },
  {
    id: 3,
    prompt: 'Damage caused by faulty work to other property is known as:',
    options: [
      { key: 'A', text: 'Impaired property' },
      { key: 'B', text: 'Resulting damage' },
      { key: 'C', text: 'Contractual carryover' },
    ],
    answer: 'B',
  },
  {
    id: 4,
    prompt: 'Coverage B most directly applies to:',
    options: [
      { key: 'A', text: 'Copyright infringement in advertising' },
      { key: 'B', text: 'Faulty workmanship' },
      { key: 'C', text: 'Water intrusion property damage' },
    ],
    answer: 'A',
  },
  {
    id: 5,
    prompt: 'Completed operations coverage applies when:',
    options: [
      { key: 'A', text: 'Work is ongoing and incomplete' },
      { key: 'B', text: 'Work is finished and damage occurs afterward' },
      { key: 'C', text: 'Only economic loss occurs' },
    ],
    answer: 'B',
  },
  {
    id: 6,
    prompt: 'Damage to Your Work exclusion primarily prevents coverage for:',
    options: [
      { key: 'A', text: 'Damage to other property' },
      { key: 'B', text: 'Repairing defective work itself' },
      { key: 'C', text: 'Advertising injury' },
    ],
    answer: 'B',
  },
  {
    id: 7,
    prompt: 'CG 20 10 generally provides Additional Insured coverage for:',
    options: [
      { key: 'A', text: 'Completed operations only' },
      { key: 'B', text: 'Ongoing operations' },
      { key: 'C', text: 'Professional services only' },
    ],
    answer: 'B',
  },
  {
    id: 8,
    prompt: 'CG 20 37 generally provides Additional Insured coverage for:',
    options: [
      { key: 'A', text: 'Completed operations' },
      { key: 'B', text: 'Ongoing operations' },
      { key: 'C', text: 'Contractual liability only' },
    ],
    answer: 'A',
  },
  {
    id: 9,
    prompt: 'Primary and noncontributory wording means:',
    options: [
      { key: 'A', text: 'Upstream insurance responds first' },
      { key: 'B', text: 'Subcontractor insurance responds first' },
      { key: 'C', text: 'All insurers split equally by default' },
    ],
    answer: 'B',
  },
  {
    id: 10,
    prompt: 'A waiver of subrogation is designed to prevent:',
    options: [
      { key: 'A', text: 'An insurer suing certain project parties after payment' },
      { key: 'B', text: 'A contractor filing a claim' },
      { key: 'C', text: 'An Additional Insured request' },
    ],
    answer: 'A',
  },
];

export default function ModuleTwoAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 2 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 2 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment verifies mastery of Module 2 CGL concepts.
            Passing score: 80 percent (8 of 10 correct).
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
            <a href="/learning/module/2/lesson/5" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 2 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/2/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
