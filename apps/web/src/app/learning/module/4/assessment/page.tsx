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
    prompt: 'Contractual risk transfer is the process of:',
    options: [
      { key: 'A', text: 'Shifting liability through written agreements' },
      { key: 'B', text: 'Only buying higher policy limits' },
      { key: 'C', text: 'Reducing subcontractor scope only' },
    ],
    answer: 'A',
  },
  {
    id: 2,
    prompt: 'The clause requiring a party to defend and reimburse another is:',
    options: [
      { key: 'A', text: 'Additional Insured clause' },
      { key: 'B', text: 'Indemnification clause' },
      { key: 'C', text: 'Notice clause only' },
    ],
    answer: 'B',
  },
  {
    id: 3,
    prompt: 'CG 20 10 generally addresses:',
    options: [
      { key: 'A', text: 'Completed operations AI' },
      { key: 'B', text: 'Ongoing operations AI' },
      { key: 'C', text: 'Waiver of subrogation only' },
    ],
    answer: 'B',
  },
  {
    id: 4,
    prompt: 'CG 20 37 generally addresses:',
    options: [
      { key: 'A', text: 'Completed operations AI' },
      { key: 'B', text: 'Ongoing operations AI' },
      { key: 'C', text: 'Primary and noncontributory only' },
    ],
    answer: 'A',
  },
  {
    id: 5,
    prompt: 'Primary and noncontributory wording is intended to ensure:',
    options: [
      { key: 'A', text: 'Upstream insurance responds first' },
      { key: 'B', text: 'Downstream insurance responds first' },
      { key: 'C', text: 'Equal sharing by default' },
    ],
    answer: 'B',
  },
  {
    id: 6,
    prompt: 'A waiver of subrogation is intended to prevent:',
    options: [
      { key: 'A', text: 'Any claim from being filed' },
      { key: 'B', text: 'Insurer recovery lawsuits against designated upstream parties' },
      { key: 'C', text: 'Additional Insured tenders' },
    ],
    answer: 'B',
  },
  {
    id: 7,
    prompt: 'A subcontractor causes a fire and owner sues GC. What allows GC to tender to subcontractor insurer?',
    options: [
      { key: 'A', text: 'Additional Insured endorsement support' },
      { key: 'B', text: 'Waiver of subrogation only' },
      { key: 'C', text: 'Pollution endorsement' },
    ],
    answer: 'A',
  },
  {
    id: 8,
    prompt: 'If downstream insurer pays then sues GC, what was most likely missing?',
    options: [
      { key: 'A', text: 'Primary and noncontributory' },
      { key: 'B', text: 'Waiver of subrogation' },
      { key: 'C', text: 'CG 20 10' },
    ],
    answer: 'B',
  },
  {
    id: 9,
    prompt: 'Contract requires ongoing and completed AI. Which pair is typically needed?',
    options: [
      { key: 'A', text: 'CG 20 10 and CG 20 37' },
      { key: 'B', text: 'CG 24 04 and CG 20 01' },
      { key: 'C', text: 'CG 20 37 and CG 24 04 only' },
    ],
    answer: 'A',
  },
  {
    id: 10,
    prompt: 'Arising out of your work in AI context is typically read as:',
    options: [
      { key: 'A', text: 'Only direct negligence by upstream party' },
      { key: 'B', text: 'Originating from or flowing from subcontractor work' },
      { key: 'C', text: 'Design professional liability only' },
    ],
    answer: 'B',
  },
];

export default function ModuleFourAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 4 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 4 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment verifies mastery of risk transfer and Additional Insured implementation.
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
            <a href="/learning/module/4/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 4 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/4/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
