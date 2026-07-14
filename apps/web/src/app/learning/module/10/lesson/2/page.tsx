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
    prompt: 'HNOA is primarily designed to cover liability involving which vehicles?',
    options: [
      { key: 'A', text: 'Employee-owned, rented, or borrowed vehicles used in business' },
      { key: 'B', text: 'Only autos titled to the contractor' },
      { key: 'C', text: 'Only trailers permanently scheduled on the policy' },
    ],
    answer: 'A',
    explanation: 'HNOA extends liability protection to non-owned and hired auto exposures used in business operations.',
  },
  {
    id: 2,
    prompt: 'Which statement about HNOA is most accurate?',
    options: [
      { key: 'A', text: 'It is liability-focused and does not automatically include physical damage for rented units' },
      { key: 'B', text: 'It automatically includes comprehensive on all rented vehicles' },
      { key: 'C', text: 'It replaces all employee personal auto policies' },
    ],
    answer: 'A',
    explanation: 'HNOA generally addresses liability, while rented unit physical damage usually requires separate treatment.',
  },
  {
    id: 3,
    prompt: 'Which scenario is a classic HNOA trigger?',
    options: [
      { key: 'A', text: 'An employee causes an accident in their own vehicle while on a company errand' },
      { key: 'B', text: 'A listed owned truck has hail damage' },
      { key: 'C', text: 'Tools are stolen from a detached trailer' },
    ],
    answer: 'A',
    explanation: 'Non-owned employee vehicle use for business is a core HNOA exposure pattern.',
  },
];

export default function ModuleTenLessonTwoPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 10 - Lesson 2">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 2: Hired and Non-Owned Auto (HNOA)</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            HNOA is one of the most important and most misunderstood components of contractor auto programs.
            It protects the business when autos not titled to the business create liability during operations.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson clarifies hired versus non-owned exposures, why severity can be high, and how to position
            HNOA in field conversations before losses occur.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: HNOA Exposure - Employee Vehicles to Rental Vehicles to Borrowed Units]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What HNOA Covers</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Employee-owned vehicles used for business tasks</li>
            <li>Rented or leased short-term vehicles used in operations</li>
            <li>Borrowed vehicles used for company purposes</li>
            <li>Business errands, pickup runs, and site-to-site travel exposures</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            HNOA is liability-oriented. Physical damage treatment for hired units is usually addressed with separate
            coverage or endorsement structure.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why It Matters for Contractors</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Field operations frequently involve personal vehicle use for business errands</li>
            <li>Project spikes often require short-term rentals and borrowed transportation</li>
            <li>Vicarious liability can attach to business operations even when the business does not own the auto</li>
            <li>Personal auto policy business-use limits can create severe gap risk</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Aon contractor auto commentary highlights non-owned vehicle claim prevalence</li>
            <li>Verisk data sets show elevated severity in non-owned and mixed-use claim cohorts</li>
            <li>Marsh casualty reporting notes distracted driving and litigation effects in business-use events</li>
            <li>Industry observations show regular rental utilization in contractor operations</li>
            <li>Business-use exclusions in personal auto language remain a persistent misunderstanding risk</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Scenarios</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Employee pickup run using personal truck leads to injury claim against the company</li>
            <li>Temporary rental van causes a liability loss while transporting jobsite materials</li>
            <li>Borrowed vehicle accident creates litigation against the contractor and driver</li>
            <li>Errand travel in a personal vehicle triggers business-use liability exposure</li>
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
          <a href="/learning/module/10/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/10/lesson/3" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
