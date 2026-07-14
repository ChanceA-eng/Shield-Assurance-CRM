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
    prompt: 'If a subcontractor does not carry valid WC coverage, the prime contractor may:',
    options: [
      { key: 'A', text: 'Become financially responsible through audit or claim transfer mechanisms' },
      { key: 'B', text: 'Automatically avoid all liability and premium impact' },
      { key: 'C', text: 'Ignore documentation requirements without consequence' },
    ],
    answer: 'A',
    explanation: 'Uninsured subcontractor exposure can transfer cost and responsibility to the contractor.',
  },
  {
    id: 2,
    prompt: 'A ghost policy is best described as:',
    options: [
      { key: 'A', text: 'A certificate-producing structure that may not provide practical injury protection' },
      { key: 'B', text: 'Guaranteed full employee coverage for all subcontractor losses' },
      { key: 'C', text: 'A required state policy for every contractor class' },
    ],
    answer: 'A',
    explanation: 'Ghost policy risk exists when certificate appearance does not match meaningful exposure transfer.',
  },
  {
    id: 3,
    prompt: 'Strong subcontractor WC control starts with:',
    options: [
      { key: 'A', text: 'Verifying active, state-appropriate, correctly named, and valid-date coverage documents' },
      { key: 'B', text: 'Collecting no documentation to reduce admin effort' },
      { key: 'C', text: 'Assuming all subcontractors are covered by default' },
    ],
    answer: 'A',
    explanation: 'Verification detail is critical to avoid audit additions and claim-transfer surprises.',
  },
];

export default function ModuleElevenLessonFourPage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 11 - Lesson 4">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 11</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 4: Subcontractor Rules and Coverage Gaps</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Subcontractor WC verification is one of the highest-impact controls in contractor insurance operations.
            This lesson explains the rule pathways, ghost policy risk, and premium consequences in clear terms.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Subcontractor WC Flow - Verified Coverage vs Contractor Liability Transfer]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Core Subcontractor Rule Logic</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>No valid WC coverage can shift financial burden to the contractor</li>
            <li>Audit processes may add uninsured subcontractor payroll exposure</li>
            <li>Claims can escalate quickly where subcontractor coverage is defective</li>
            <li>Documentation quality is a primary defense control</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Certificate Verification Standards</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Active dates with no lapse during work period</li>
            <li>Correct legal named insured and matching entity structure</li>
            <li>Correct state and jurisdiction applicability</li>
            <li>Carrier/policy details suitable for independent verification</li>
            <li>No reliance on certificate-only assumptions when exclusions or ghost structures are suspected</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data Signals and Cited Sources</h2>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Aon and Marsh benchmarks identify uninsured/underinsured subcontractor risk as a recurring driver</li>
            <li>NCCI audit studies show meaningful premium impact from subcontractor documentation failures</li>
            <li>Regulatory commentary continues to emphasize misclassification and compliance penalty exposure</li>
            <li>Construction injury severity data supports proactive transfer and verification controls</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Real-World Scenarios</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Uninsured subcontractor injury adds payroll and loss burden during policy audit</li>
            <li>Ghost policy certificate appears valid until claim reveals functional gap</li>
            <li>Coverage in wrong state fails transfer expectations in jurisdiction-specific claim</li>
            <li>Strong verification process prevents downstream premium and claim shocks</li>
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
          <a href="/learning/module/11/lesson/3" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/11/assessment" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Take Assessment</a>
        </div>
      </div>
    </SectionLayout>
  );
}
