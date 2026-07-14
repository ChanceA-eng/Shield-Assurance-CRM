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
    prompt: 'Class codes are primarily used to determine:',
    options: [
      { key: 'A', text: 'Job risk category and workers compensation pricing basis' },
      { key: 'B', text: 'Commercial auto symbol selection' },
      { key: 'C', text: 'Only equipment replacement cost' },
    ],
    answer: 'A',
    explanation: 'Class codes categorize work risk and drive rate application in premium calculations.',
  },
  {
    id: 2,
    prompt: 'Insurers assign class codes based on:',
    options: [
      { key: 'A', text: 'Actual duties performed, not just titles or business names' },
      { key: 'B', text: 'Only the company logo and marketing category' },
      { key: 'C', text: 'Personal preference of payroll staff' },
    ],
    answer: 'A',
    explanation: 'Code assignment is duty-driven and audit-verified against operational reality.',
  },
  {
    id: 3,
    prompt: 'For multi-trade employee duties, classification usually follows:',
    options: [
      { key: 'A', text: 'The highest-risk task performed where separation is not clearly documented' },
      { key: 'B', text: 'The lowest-risk task by default' },
      { key: 'C', text: 'A random split every quarter' },
    ],
    answer: 'A',
    explanation: 'Without qualifying separation records, the higher-risk operational exposure commonly controls.',
  },
];

export default function ModuleElevenLessonTwoPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 11 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 11</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Classification Codes</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Class codes are the pricing language of workers compensation. In plain terms, they connect what people do
            on the job to the risk rate used in premium calculations.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson explains exactly how class codes work, why misclassification is expensive, and how multi-trade
            operations should document duties to avoid audit surprises.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Class Code Structure - Job Type to Risk Level to Rate to Premium]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What Class Codes Are</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Numeric work classifications tied to risk categories</li>
            <li>Used with payroll to calculate manual premium</li>
            <li>Assigned by actual duties, tools, and environment</li>
            <li>Directly reviewed and corrected during audit</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why They Matter</h2>
          <div className="rounded bg-slate-100 p-4 text-sm text-slate-800">
            Premium = (Payroll / 100) x Class Code Rate x Experience Mod
          </div>
          <p className="mt-4 leading-relaxed text-slate-700">
            A wrong class code means a wrong premium. Understating risk can trigger major audit bill increases;
            overstating risk can overcharge an account and reduce competitiveness.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NCCI audit and compliance commentary highlights ongoing class code correction volume</li>
            <li>Construction benchmark studies show multi-trade classification errors as a persistent issue</li>
            <li>Audit enforcement trends continue to penalize documentation and assignment breakdowns</li>
            <li>Misclassification can materially shift premiums, especially in high-rate trade classes</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">How Insurers Assign Codes</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Review duty detail and where the work occurs</li>
            <li>Evaluate tools, hazards, and physical task profile</li>
            <li>Assess task share where multiple duties exist</li>
            <li>Apply higher-risk treatment where documentation is not sufficiently separated</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
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
          <a href="/learning/module/11/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/11/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
