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
    prompt: 'Workers Compensation is best described as:',
    options: [
      { key: 'A', text: 'Optional coverage for small contractors' },
      { key: 'B', text: 'Statutory coverage required by law in most contractor operations' },
      { key: 'C', text: 'A replacement for CGL liability coverage' },
    ],
    answer: 'B',
  },
  {
    id: 2,
    prompt: 'Which set of benefits is most aligned with workers compensation?',
    options: [
      { key: 'A', text: 'Medical, wage replacement, disability, and death benefits' },
      { key: 'B', text: 'Only legal defense for lawsuits' },
      { key: 'C', text: 'Property damage and completed operations' },
    ],
    answer: 'A',
  },
  {
    id: 3,
    prompt: 'CGL generally excludes which type of claim?',
    options: [
      { key: 'A', text: 'Third-party property damage' },
      { key: 'B', text: 'Employee injury arising out of employment' },
      { key: 'C', text: 'Products-completed operations claims' },
    ],
    answer: 'B',
  },
  {
    id: 4,
    prompt: 'Employer Liability is primarily intended to cover:',
    options: [
      { key: 'A', text: 'Lawsuits connected to employee injury that workers comp benefits do not fully absorb' },
      { key: 'B', text: 'Auto liability events' },
      { key: 'C', text: 'Pollution cleanup penalties' },
    ],
    answer: 'A',
  },
  {
    id: 5,
    prompt: 'A spouse brings a loss-of-consortium claim after an employee injury. Which coverage is most relevant?',
    options: [
      { key: 'A', text: 'Workers Compensation only' },
      { key: 'B', text: 'Employer Liability' },
      { key: 'C', text: 'CGL Coverage A' },
    ],
    answer: 'B',
  },
  {
    id: 6,
    prompt: 'A worker labeled 1099 is injured, then classified by the state as employee status. What follows?',
    options: [
      { key: 'A', text: 'No workers compensation obligation because an invoice was used' },
      { key: 'B', text: 'Workers compensation obligations can apply with potential penalty exposure' },
      { key: 'C', text: 'CGL automatically replaces workers compensation' },
    ],
    answer: 'B',
  },
  {
    id: 7,
    prompt: 'If a subcontractor has no workers compensation in force, a common upstream concern is:',
    options: [
      { key: 'A', text: 'Injury cost pressure and compliance risk shifting to the hiring contractor' },
      { key: 'B', text: 'Automatic additional insured status for all parties' },
      { key: 'C', text: 'Waiver of subrogation cancellation by default' },
    ],
    answer: 'A',
  },
  {
    id: 8,
    prompt: 'Which is a common statutory penalty outcome for workers compensation noncompliance?',
    options: [
      { key: 'A', text: 'Stop-work order and monetary penalty exposure' },
      { key: 'B', text: 'Automatic renewal discount' },
      { key: 'C', text: 'Completed operations credit' },
    ],
    answer: 'A',
  },
  {
    id: 9,
    prompt: 'Which statement is most accurate?',
    options: [
      { key: 'A', text: 'Workers Compensation and Employer Liability are unrelated policy concepts' },
      { key: 'B', text: 'Workers Compensation pays benefits while Employer Liability addresses specified lawsuits' },
      { key: 'C', text: 'Employer Liability replaces all CGL functions' },
    ],
    answer: 'B',
  },
  {
    id: 10,
    prompt: 'What is the best response to: "I only use 1099 labor, so workers compensation is not required"?',
    options: [
      { key: 'A', text: 'Correct, tax labels always eliminate workers compensation obligations' },
      { key: 'B', text: 'No issue because CGL will respond to employee injuries' },
      { key: 'C', text: 'State classification tests control and obligations can still apply' },
    ],
    answer: 'C',
  },
];

export default function ModuleFiveAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 5 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 5 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment validates understanding of workers compensation, Employer Liability, labor classification,
            uninsured subcontractor risk, and statutory compliance outcomes. Passing score: 80 percent.
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
            <a href="/learning/module/5/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 5 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/5/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
