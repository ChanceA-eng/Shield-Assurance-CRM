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
    prompt: 'What most directly influences BOP vs CPP placement in underwriting?',
    options: [
      { key: 'A', text: 'Revenue, hazard class, claims trend, and operational complexity' },
      { key: 'B', text: 'Only company logo design' },
      { key: 'C', text: 'Only fleet color standardization' },
    ],
    answer: 'A',
    explanation: 'Eligibility is multi-factor and typically includes size, hazard, claims, and operational footprint.',
  },
  {
    id: 2,
    prompt: 'Which statement best describes carrier appetite?',
    options: [
      { key: 'A', text: 'Carrier appetite varies by trade class, geography, controls, and loss history' },
      { key: 'B', text: 'All carriers write all contractor classes identically' },
      { key: 'C', text: 'Carrier appetite is fixed permanently across all years' },
    ],
    answer: 'A',
    explanation: 'Appetite shifts with strategy, reinsurance, loss trends, and portfolio objectives.',
  },
  {
    id: 3,
    prompt: 'Which condition is a common underwriting red flag?',
    options: [
      { key: 'A', text: 'Poor claims controls combined with expanding high-hazard operations' },
      { key: 'B', text: 'Documented safety program improvement and stable loss trend' },
      { key: 'C', text: 'Clear subcontractor transfer controls with strong documentation' },
    ],
    answer: 'A',
    explanation: 'Adverse loss controls and hazard expansion often trigger stricter terms or different placement outcomes.',
  },
];

export default function ModuleNineLessonThreePage(): JSX.Element {
  const [selected, setSelected] = useState<Partial<Record<number, Choice>>>({});

  return (
    <SectionLayout title="Module 9 - Lesson 3">
      <div className="mx-auto max-w-5xl space-y-12 px-6 py-14">
        <header className="border-b border-slate-200 pb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9</span>
          <h1 className="mt-2 text-3xl font-extrabold text-slate-900">Lesson 3: Eligibility, Underwriting, and Carrier Appetite</h1>
        </header>

        <section className="space-y-4">
          <h2 className="text-xl font-bold text-slate-900">Overview</h2>
          <p className="text-lg leading-relaxed text-slate-700">
            Eligibility and appetite determine whether a contractor fits a BOP structure or requires CPP placement.
            This lesson focuses on underwriting logic, red flags, and practical evidence that improves market outcomes.
          </p>
          <p className="leading-relaxed text-slate-700">
            You will learn how to map operation characteristics to carrier preference and reduce avoidable placement friction.
          </p>
        </section>

        <div className="flex h-56 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Eligibility and Appetite Decision Flow - BOP to CPP]
        </div>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Common Eligibility Drivers</h2>
          <ul className="space-y-4 text-base text-slate-700">
            <li>Revenue, payroll, and project size profile</li>
            <li>Trade class hazard and operation complexity</li>
            <li>Territory spread and jurisdictional variation</li>
            <li>Claims frequency, severity, and trend quality</li>
            <li>Safety controls and subcontractor management discipline</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Carrier Appetite Signals</h2>
          <p className="mb-4 leading-relaxed text-slate-700">
            Appetite is not static. It changes with portfolio performance, reinsurance dynamics, and macro loss trends.
            The same contractor can receive different responses based on timing, controls, and market cycle stage.
          </p>
          <ul className="list-disc space-y-3 pl-4 text-base text-slate-700">
            <li>Preferred classes receive broader terms and steadier pricing</li>
            <li>Watch-list classes face tighter terms and stronger documentation demand</li>
            <li>Distressed classes may require specialty or layered approaches</li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Data-Backed Underwriting Context</h2>
          <p className="leading-relaxed text-slate-700">
            Commentary from AM Best, Marsh, Aon, Deloitte, and Verisk continues to indicate rising contractor loss pressure,
            stronger underwriting selectivity, and increased emphasis on control quality and operational transparency.
          </p>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-xl font-bold text-slate-900">Field Script</h2>
          <blockquote className="border-l-4 border-slate-900 pl-4 italic leading-relaxed text-slate-800">
            Underwriting is about predictability. If we show clear controls, stable trends, and accurate operation detail,
            we improve both appetite response and term quality.
          </blockquote>
        </section>

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

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <a href="/learning/module/9/lesson/2" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Previous</a>
          <a href="/learning/module/9/lesson/4" className="rounded-lg bg-slate-950 px-8 py-3 text-sm font-semibold text-white hover:bg-slate-800">Next Lesson</a>
        </div>
      </div>
    </SectionLayout>
  );
}
