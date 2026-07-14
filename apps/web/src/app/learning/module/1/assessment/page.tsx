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
    prompt: 'Which legal system governs negligence causing physical injury or property damage?',
    options: [
      { key: 'A', text: 'Tort Law' },
      { key: 'B', text: 'Contract Law' },
      { key: 'C', text: 'Statutory Law' },
    ],
    answer: 'A',
  },
  {
    id: 2,
    prompt: 'A contractor misreads a blueprint and installs HVAC off-spec. No physical damage occurs. What type of loss is this?',
    options: [
      { key: 'A', text: 'Physical Loss' },
      { key: 'B', text: 'Economic Loss' },
      { key: 'C', text: 'Contractual Loss' },
    ],
    answer: 'C',
  },
  {
    id: 3,
    prompt: 'Under ISO CG 00 01, which condition must exist for CGL Coverage A to respond?',
    options: [
      { key: 'A', text: 'A breach of contract' },
      { key: 'B', text: 'Bodily injury or property damage' },
      { key: 'C', text: 'A financial loss over a threshold amount' },
    ],
    answer: 'B',
  },
  {
    id: 4,
    prompt: 'What does the Economic Loss Rule generally prevent?',
    options: [
      { key: 'A', text: 'Recovery of physical damage in tort' },
      { key: 'B', text: 'Recovery of purely financial losses in tort' },
      { key: 'C', text: 'Recovery of statutory fines by regulators' },
    ],
    answer: 'B',
  },
  {
    id: 5,
    prompt: 'Which Arizona case is foundational for state ELR analysis?',
    options: [
      { key: 'A', text: 'Sullivan v. Pulte Home Corp.' },
      { key: 'B', text: 'Flagstaff Affordable Housing v. Design Alliance' },
      { key: 'C', text: 'Smith v. Contractors West' },
    ],
    answer: 'B',
  },
  {
    id: 6,
    prompt: 'A subcontractor installs flooring incorrectly and only the flooring itself is damaged. Which lane is most appropriate?',
    options: [
      { key: 'A', text: 'CGL Coverage A' },
      { key: 'B', text: 'Contractors E and O' },
      { key: 'C', text: 'Umbrella Liability' },
    ],
    answer: 'B',
  },
  {
    id: 7,
    prompt: 'Which legal pathway governs licensing and code violations?',
    options: [
      { key: 'A', text: 'Tort Law' },
      { key: 'B', text: 'Contract Law' },
      { key: 'C', text: 'Statutory Law' },
    ],
    answer: 'C',
  },
  {
    id: 8,
    prompt: 'A roofer drops a tool and damages a vehicle. What type of loss is this?',
    options: [
      { key: 'A', text: 'Economic Loss' },
      { key: 'B', text: 'Physical Loss' },
      { key: 'C', text: 'Contractual Loss' },
    ],
    answer: 'B',
  },
  {
    id: 9,
    prompt: 'Which coverage lane may respond when faulty work causes damage to other property?',
    options: [
      { key: 'A', text: 'CGL Coverage A' },
      { key: 'B', text: 'Contractors E and O' },
      { key: 'C', text: 'None' },
    ],
    answer: 'A',
  },
  {
    id: 10,
    prompt: 'Which exposure is generally non-insurable under commercial insurance structures?',
    options: [
      { key: 'A', text: 'Contractual Loss' },
      { key: 'B', text: 'Statutory fines and penalties' },
      { key: 'C', text: 'Economic Loss' },
    ],
    answer: 'B',
  },
];

export default function ModuleOneAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 1 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 1 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment verifies mastery of the legal foundations of contractor liability.
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
            <a href="/learning/module/1/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Lesson 3</a>
            <a href="/learning/module/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Module Overview</a>
            <a href="/learning" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Exit to Learning Center</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 1 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module 2</a>
              <a href="/learning/module/1/complete" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Go to Module 1 Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
