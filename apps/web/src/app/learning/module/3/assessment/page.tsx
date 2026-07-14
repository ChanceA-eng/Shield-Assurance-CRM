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
    prompt: 'E and O coverage is primarily triggered by:',
    options: [
      { key: 'A', text: 'Bodily injury or property damage' },
      { key: 'B', text: 'Professional error causing financial harm' },
      { key: 'C', text: 'Completed operations timing alone' },
    ],
    answer: 'B',
  },
  {
    id: 2,
    prompt: 'Faulty workmanship that damages only itself is generally:',
    options: [
      { key: 'A', text: 'Covered under CGL by default' },
      { key: 'B', text: 'An E and O lane exposure' },
      { key: 'C', text: 'Covered under both without conditions' },
    ],
    answer: 'B',
  },
  {
    id: 3,
    prompt: 'Economic loss without physical damage is usually:',
    options: [
      { key: 'A', text: 'Covered under CGL' },
      { key: 'B', text: 'Excluded by CGL and addressed by E and O' },
      { key: 'C', text: 'Excluded by both by default' },
    ],
    answer: 'B',
  },
  {
    id: 4,
    prompt: 'Professional services performed by contractors include:',
    options: [
      { key: 'A', text: 'Only formal architectural design' },
      { key: 'B', text: 'Interpreting plans, recommending materials, and field modifications' },
      { key: 'C', text: 'None in normal contractor operations' },
    ],
    answer: 'B',
  },
  {
    id: 5,
    prompt: 'CGL most directly responds when:',
    options: [
      { key: 'A', text: 'Professional mistakes occur without damage' },
      { key: 'B', text: 'Bodily injury or property damage occurs' },
      { key: 'C', text: 'Economic delay costs occur' },
    ],
    answer: 'B',
  },
  {
    id: 6,
    prompt: 'A blueprint misread causes a 50,000 dollar delay with no physical damage. Primary lane?',
    options: [
      { key: 'A', text: 'CGL' },
      { key: 'B', text: 'E and O' },
      { key: 'C', text: 'No lane applies' },
    ],
    answer: 'B',
  },
  {
    id: 7,
    prompt: 'Wrong material recommendation causing cost overruns is best classified as:',
    options: [
      { key: 'A', text: 'Professional error likely in E and O lane' },
      { key: 'B', text: 'Automatic CGL property damage claim' },
      { key: 'C', text: 'Only contractual liability regardless of policy' },
    ],
    answer: 'A',
  },
  {
    id: 8,
    prompt: 'E and O is often used to address gaps tied to which CGL concept?',
    options: [
      { key: 'A', text: 'Damage to Your Work style limitations' },
      { key: 'B', text: 'Liquor liability' },
      { key: 'C', text: 'Aircraft liability' },
    ],
    answer: 'A',
  },
  {
    id: 9,
    prompt: 'A field design modification creates a defect condition with no property damage yet. Primary lane?',
    options: [
      { key: 'A', text: 'CGL only' },
      { key: 'B', text: 'E and O' },
      { key: 'C', text: 'No policy can ever apply' },
    ],
    answer: 'B',
  },
  {
    id: 10,
    prompt: 'Core difference between CGL and E and O in this module is:',
    options: [
      { key: 'A', text: 'Accident-trigger model vs professional-error model' },
      { key: 'B', text: 'Property vs auto coverage' },
      { key: 'C', text: 'State filing class only' },
    ],
    answer: 'A',
  },
];

export default function ModuleThreeAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 3 Final Assessment">
      <div className="mx-auto max-w-4xl space-y-10 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <h1 className="text-3xl font-extrabold text-slate-900">Module 3 Final Assessment</h1>
          <p className="mt-2 text-lg leading-relaxed text-slate-600">
            This assessment verifies mastery of Contractors Professional Liability concepts.
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
            <a href="/learning/module/3/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          </div>
        </div>

        {submitted ? (
          <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
            <h2 className="mb-2 text-xl font-bold text-slate-900">Your Results</h2>
            <p className="mb-3 text-lg text-slate-700">You scored {score}/10 ({percent}%).</p>
            <p className={`font-semibold ${passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {passed ? 'You passed. Excellent work.' : 'You did not pass yet. Review Module 3 and retake the assessment.'}
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <a href="/learning/module/3/complete" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Continue to Module Completion</a>
            </div>
          </section>
        ) : null}
      </div>
    </SectionLayout>
  );
}
