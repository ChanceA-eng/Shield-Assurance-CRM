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
    prompt: 'Commercial auto liability primarily covers:',
    options: [
      { key: 'A', text: 'Bodily injury and property damage caused by covered business auto use' },
      { key: 'B', text: 'Employee injury wage replacement benefits' },
      { key: 'C', text: 'Professional services economic loss only' },
    ],
    answer: 'A',
  },
  {
    id: 2,
    prompt: 'Why do personal auto denials appear in contractor claims?',
    options: [
      { key: 'A', text: 'Because personal auto policies are often not built for business-use activity' },
      { key: 'B', text: 'Because all personal policies cover only parked vehicles' },
      { key: 'C', text: 'Because CGL overrides personal auto by default' },
    ],
    answer: 'A',
  },
  {
    id: 3,
    prompt: 'Hired auto liability is most associated with:',
    options: [
      { key: 'A', text: 'Rented, leased, or borrowed vehicles used for business' },
      { key: 'B', text: 'Employee-owned vehicles only' },
      { key: 'C', text: 'Owned autos listed on workers compensation' },
    ],
    answer: 'A',
  },
  {
    id: 4,
    prompt: 'Non-owned auto liability is most associated with:',
    options: [
      { key: 'A', text: 'Employee-owned vehicles used for company business' },
      { key: 'B', text: 'Only company-titled trucks' },
      { key: 'C', text: 'Only temporary substitute rental vehicles' },
    ],
    answer: 'A',
  },
  {
    id: 5,
    prompt: 'A contractor rents a van, the rental limit is inadequate, and a severe accident occurs. Which concept best applies?',
    options: [
      { key: 'A', text: 'Non-owned auto liability' },
      { key: 'B', text: 'Hired auto liability' },
      { key: 'C', text: 'Workers compensation employer liability' },
    ],
    answer: 'B',
  },
  {
    id: 6,
    prompt: 'Best response to: "We do not own vehicles, so we do not need auto liability"?',
    options: [
      { key: 'A', text: 'Correct, ownership is the only trigger' },
      { key: 'B', text: 'Business-use driving still creates employer liability even without owned autos' },
      { key: 'C', text: 'CGL absorbs all auto claims in that scenario' },
    ],
    answer: 'B',
  },
  {
    id: 7,
    prompt: 'Vicarious liability generally means:',
    options: [
      { key: 'A', text: 'The employer can be held responsible for employee acts within work scope' },
      { key: 'B', text: 'Only the vehicle owner can be sued' },
      { key: 'C', text: 'Claims are limited to owned-fleet operations' },
    ],
    answer: 'A',
  },
  {
    id: 8,
    prompt: 'Employee uses personal truck for jobsite material pickup and causes an accident. Which coverage concept is key?',
    options: [
      { key: 'A', text: 'Non-owned auto liability' },
      { key: 'B', text: 'CGL premises liability' },
      { key: 'C', text: 'Builders risk installation floater' },
    ],
    answer: 'A',
  },
  {
    id: 9,
    prompt: 'Which statement is most accurate regarding CGL and auto losses?',
    options: [
      { key: 'A', text: 'CGL commonly contains auto exclusions, so it is not a substitute for business auto structure' },
      { key: 'B', text: 'CGL replaces hired and non-owned auto coverage in most contractor accounts' },
      { key: 'C', text: 'CGL always sits primary for owned auto accidents' },
    ],
    answer: 'A',
  },
  {
    id: 10,
    prompt: 'A contractor borrows a truck from another party for business hauling and a crash occurs. Most relevant concept?',
    options: [
      { key: 'A', text: 'Hired auto liability' },
      { key: 'B', text: 'Non-owned auto liability' },
      { key: 'C', text: 'Workers compensation only' },
    ],
    answer: 'A',
  },
];

export default function ModuleSixAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 6 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 6 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment validates understanding of commercial auto liability, hired and non-owned auto,
            employee vehicle exposure, and employer-side legal responsibility.
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
            <a href="/learning/module/6/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 6 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/6/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
