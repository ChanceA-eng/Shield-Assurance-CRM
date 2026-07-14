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
    prompt: 'Roofing materials are damaged by wind before installation. Which coverage concept is most relevant?',
    options: [
      { key: 'A', text: 'CGL Coverage A' },
      { key: 'B', text: 'Inland marine for materials before installation' },
      { key: 'C', text: 'Workers compensation' },
    ],
    answer: 'B',
    explanation: 'Inland marine is designed for materials in staging and pre-installation conditions where basic property assumptions may not hold.',
  },
  {
    id: 2,
    prompt: 'Materials are damaged while being transported between jobsites. Which coverage concept is central?',
    options: [
      { key: 'A', text: 'Standard fixed-location property only' },
      { key: 'B', text: 'Inland marine transit protection' },
      { key: 'C', text: 'Employment practices liability' },
    ],
    answer: 'B',
    explanation: 'Transit exposure is a core inland marine scenario in contractor operations.',
  },
  {
    id: 3,
    prompt: 'Copper wire stored at a jobsite is stolen. Why is inland marine often needed?',
    options: [
      { key: 'A', text: 'Because all theft is automatically covered under CGL' },
      { key: 'B', text: 'Because jobsite pre-installation material storage often needs inland marine structure' },
      { key: 'C', text: 'Because workers compensation responds to material theft' },
    ],
    answer: 'B',
    explanation: 'Jobsite material theft before installation is commonly addressed through inland marine-oriented property planning.',
  },
];

export default function ModuleSevenLessonThreePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 7 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 7</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Materials, Supplies, and Jobsite Property</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Materials and supplies are high-frequency loss points in contractor operations. Exposure begins before installation,
            continues through transit, and expands across temporary storage and active jobsite staging.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson adds scenario depth and a multi-question knowledge check to reinforce how inland marine supports these moving risk zones.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Materials and Jobsite Property Flow - Storage to Transit to Install]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Where Materials Are Most Vulnerable</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Unsecured staging areas and temporary storage zones</li>
            <li>Delivery-to-installation time gaps</li>
            <li>Open-air exposure to rain, wind, and temperature extremes</li>
            <li>Transit shifts, impact damage, and handling incidents</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Expanded Contractor Scenarios</h2>
          <ul className="space-y-6 text-base text-slate-700">
            <li><strong>Copper theft:</strong> high-value material removed from overnight site storage.</li>
            <li><strong>Storm damage:</strong> delivered material destroyed before installation starts.</li>
            <li><strong>Transit incident:</strong> palletized supplies damaged between projects.</li>
            <li><strong>Job box breach:</strong> mixed material and tool loss from temporary site containers.</li>
          </ul>
        </section>

        <div className="flex h-48 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Common Materials Loss Types - Theft Weather Transit]
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
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

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Positioning Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Materials on a jobsite are project cash waiting to be installed. Inland marine protects that value during storage,
            movement, and pre-install windows where losses usually occur.
          </blockquote>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/7/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/7/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
