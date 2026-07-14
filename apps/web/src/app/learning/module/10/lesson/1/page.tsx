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
    prompt: 'Auto liability primarily covers which category of loss?',
    options: [
      { key: 'A', text: 'Bodily injury and property damage to other parties' },
      { key: 'B', text: 'Only damage to the insured contractor truck' },
      { key: 'C', text: 'Only theft of tools from a trailer' },
    ],
    answer: 'A',
    explanation: 'Auto liability is third-party protection for injury and property damage allegations.',
  },
  {
    id: 2,
    prompt: 'Collision coverage is designed for:',
    options: [
      { key: 'A', text: 'Damage from impact with another vehicle or object' },
      { key: 'B', text: 'Only hail and theft losses' },
      { key: 'C', text: 'Third-party bodily injury claims' },
    ],
    answer: 'A',
    explanation: 'Collision applies when the covered vehicle strikes another vehicle or object.',
  },
  {
    id: 3,
    prompt: 'Comprehensive coverage best fits which loss type?',
    options: [
      { key: 'A', text: 'Theft, vandalism, fire, hail, and other non-collision causes' },
      { key: 'B', text: 'Rear-end liability claims' },
      { key: 'C', text: 'All employee-owned auto claims automatically' },
    ],
    answer: 'A',
    explanation: 'Comprehensive addresses non-collision loss causes including weather and theft events.',
  },
];

export default function ModuleTenLessonOnePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 10 - Lesson 1">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 1: Auto Liability and Physical Damage</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Commercial Auto is one of the most loss-heavy lines in contractor insurance. Liability protects against
            third-party injury and damage claims, while physical damage protects the contractor's own vehicles.
          </p>
          <p className="leading-relaxed text-slate-700">
            This lesson builds the foundation for coverage analysis, explaining how each part responds and where
            claim severity trends are reshaping pricing and underwriting.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Auto Liability vs Physical Damage - Third-Party vs Owned Vehicle]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Auto Liability</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Bodily injury liability for injuries to drivers, passengers, and pedestrians</li>
            <li>Property damage liability for vehicles, structures, and other third-party property</li>
            <li>Defense expense and legal cost support within policy design parameters</li>
            <li>High-severity exposure in contractor operations due to frequent road use and heavy units</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Physical Damage</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Collision: impact-related damage to covered autos</li>
            <li>Comprehensive: theft, weather, fire, vandalism, and other non-collision causes</li>
            <li>Specified causes option in selected forms for narrower causes of loss</li>
            <li>Critical for financed vehicles, expensive fleets, and custom contractor units</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>AM Best: commercial auto severity pressure remains elevated</li>
            <li>CCC Intelligent Solutions: repair inflation and parts/labor pressure persists</li>
            <li>Marsh: casualty litigation trends continue to influence liability cost outcomes</li>
            <li>Verisk: contractor classes show higher frequency patterns in multiple segments</li>
            <li>Aon: trailer and non-owned vehicle contexts are meaningful claim drivers</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Contractor Scenarios</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Rear-end crash while towing: liability responds to third-party injury and damage claims</li>
            <li>Work truck theft from jobsite: comprehensive responds to vehicle loss</li>
            <li>Hail event on multiple units: comprehensive applies to covered weather damage</li>
            <li>Impact with site equipment: liability and collision may respond to different damage elements</li>
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
          <a href="/learning/module/10" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/10/lesson/2" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
