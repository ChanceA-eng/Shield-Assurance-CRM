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
    prompt: 'A mod below 1.00 generally means:',
    options: [
      { key: 'A', text: 'Claims performance is better than expected and premium impact is favorable' },
      { key: 'B', text: 'No workers compensation coverage exists' },
      { key: 'C', text: 'Class codes are ignored in pricing' },
    ],
    answer: 'A',
    explanation: 'A lower mod is generally associated with lower-than-expected experience and improved pricing.',
  },
  {
    id: 2,
    prompt: 'The mod concept compares:',
    options: [
      { key: 'A', text: 'Actual claims experience versus expected claims for similar risk/profile' },
      { key: 'B', text: 'Only payroll totals and revenue growth' },
      { key: 'C', text: 'Only commercial auto losses' },
    ],
    answer: 'A',
    explanation: 'Experience rating compares actual versus expected loss performance.',
  },
  {
    id: 3,
    prompt: 'Which action often helps reduce mod pressure over time?',
    options: [
      { key: 'A', text: 'Strong return-to-work and early claim management processes' },
      { key: 'B', text: 'Ignoring minor incidents until renewal' },
      { key: 'C', text: 'Avoiding payroll record detail' },
    ],
    answer: 'A',
    explanation: 'Claim handling discipline and return-to-work strategy can reduce severity and rating impact.',
  },
];

export default function ModuleElevenLessonThreePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 11 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 11</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Experience Mods</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Experience mods are pricing multipliers tied to claim performance. This lesson explains the concept in plain
            language so the connection between claims discipline and premium outcome is clear.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Experience Mod Flow - Claims to Mod to Premium Adjustment]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">What a Mod Is</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>1.00 is baseline expected performance</li>
            <li>Below 1.00 generally improves premium outcome</li>
            <li>Above 1.00 generally increases premium burden</li>
            <li>Small changes can create large dollar impact on large payrolls</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Why It Matters</h2>
          <div className="rounded bg-slate-100 p-4 text-sm text-slate-800">
            Premium = (Payroll / 100) x Class Code Rate x Experience Mod
          </div>
          <p className="mt-4 leading-relaxed text-slate-700">
            Because mod is multiplicative, operational safety and claim handling performance have direct pricing
            consequences year over year.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>NCCI commentary continues to show measurable premium divergence by mod tier</li>
            <li>Return-to-work programs are consistently linked to reduced severity pressure</li>
            <li>Medical-only claim treatment can reduce rating impact versus lost-time conversion</li>
            <li>Smaller payroll profiles are often more sensitive to single-severity events</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">How Contractors Improve Mod Outcomes</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Invest in safety controls and recurring field training</li>
            <li>Report incidents quickly to limit severity escalation</li>
            <li>Execute return-to-work pathways where clinically appropriate</li>
            <li>Maintain documentation quality for claim and payroll review</li>
            <li>Verify subcontractor coverage to prevent avoidable audit additions</li>
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
          <a href="/learning/module/11/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/11/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
