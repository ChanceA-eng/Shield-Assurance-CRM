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
    prompt: 'Workers compensation medical benefits typically include:',
    options: [
      { key: 'A', text: 'Doctor care, surgery, therapy, and prescriptions for covered injuries' },
      { key: 'B', text: 'Only damage to employer vehicles' },
      { key: 'C', text: 'Only general liability settlements' },
    ],
    answer: 'A',
    explanation: 'Medical benefits are the core employee treatment component of workers compensation.',
  },
  {
    id: 2,
    prompt: 'Employers Liability (Part B) primarily helps protect against:',
    options: [
      { key: 'A', text: 'Lawsuits tied to employee injury scenarios not fully contained by statutory benefits' },
      { key: 'B', text: 'Only trailer theft losses' },
      { key: 'C', text: 'Only non-owned auto claims' },
    ],
    answer: 'A',
    explanation: 'Part B addresses lawsuit pathways including third-party over actions and related claims.',
  },
  {
    id: 3,
    prompt: 'Which contractor injury pattern is frequently cited in WC data?',
    options: [
      { key: 'A', text: 'Lifting and strain injuries in physically intensive job functions' },
      { key: 'B', text: 'Software implementation errors' },
      { key: 'C', text: 'Customer billing disputes' },
    ],
    answer: 'A',
    explanation: 'Strain/sprain and lifting incidents are persistent loss drivers in contractor WC cohorts.',
  },
];

export default function ModuleElevenLessonOnePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 11 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 11</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: WC Benefits and Employer Liability</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            This lesson explains workers compensation benefits and employer liability in plain field language.
            The goal is to connect statutory benefit mechanics to real contractor claim outcomes.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: WC Benefits Diagram - Medical to Wage to Disability to Employer Liability]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Workers Compensation Benefits</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Medical treatment for covered work-related injury and illness events</li>
            <li>Wage replacement support for approved lost-time periods</li>
            <li>Permanent disability pathways where lasting impairment is determined</li>
            <li>Death benefit structures for eligible dependents in fatal outcomes</li>
          </ul>
          <p className="mt-4 leading-relaxed text-slate-700">
            These benefits are legally structured and state-regulated, making compliance precision critical.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Employer Liability (Part B)</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Third-party over actions in multi-contractor litigation chains</li>
            <li>Loss-of-consortium and related derivative lawsuit exposures</li>
            <li>Dual-capacity allegations where employer role is challenged</li>
            <li>Defense coordination in high-severity contested injury matters</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NCCI reporting indicates sustained pressure in construction claim trends</li>
            <li>BLS and safety data continue to show elevated contractor injury and fatality exposure</li>
            <li>Aon and OSHA studies note recurring strain, fall, and struck-by claim patterns</li>
            <li>Loss severity inflation underscores the value of return-to-work and safety controls</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Scenarios</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Lifting injury with immediate treatment and wage replacement initiation</li>
            <li>Fall injury requiring surgery and temporary disability support</li>
            <li>Third-party over action where employer liability pathway is activated</li>
            <li>Uninsured subcontractor injury triggering contractor-side obligation</li>
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
          <a href="/learning/module/11" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/11/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
