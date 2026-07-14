'use client';

import { useMemo, useState } from 'react';
import SectionLayout from '../../../../../components/crm/SectionLayout';

type Choice = 'A' | 'B' | 'C' | 'D';

type AssessmentQuestion = {
  id: number;
  prompt: string;
  choices: Array<{ key: Choice; text: string }>;
  answer: Choice;
  explanation: string;
};

const questions: AssessmentQuestion[] = [
  {
    id: 1,
    prompt: 'Auto liability is primarily designed to protect against:',
    choices: [
      { key: 'A', text: 'Third-party bodily injury and property damage claims' },
      { key: 'B', text: 'Only theft of the insured vehicle' },
      { key: 'C', text: 'Only damage to attached tools' },
      { key: 'D', text: 'Only non-owned auto physical damage' },
    ],
    answer: 'A',
    explanation: 'Auto liability responds to third-party injury and property damage allegations.',
  },
  {
    id: 2,
    prompt: 'Collision coverage typically applies to:',
    choices: [
      { key: 'A', text: 'Impact damage from striking another vehicle or object' },
      { key: 'B', text: 'Only theft and weather losses' },
      { key: 'C', text: 'Only defense costs in liability lawsuits' },
      { key: 'D', text: 'Employee-owned vehicle liability only' },
    ],
    answer: 'A',
    explanation: 'Collision addresses impact-related damage to covered autos.',
  },
  {
    id: 3,
    prompt: 'Comprehensive coverage commonly responds to:',
    choices: [
      { key: 'A', text: 'Theft, fire, hail, vandalism, and other non-collision causes' },
      { key: 'B', text: 'Only rear-end crash claims' },
      { key: 'C', text: 'Only property damage to other parties' },
      { key: 'D', text: 'Only employee auto claims' },
    ],
    answer: 'A',
    explanation: 'Comprehensive is non-collision protection for covered autos.',
  },
  {
    id: 4,
    prompt: 'HNOA primarily addresses liability involving:',
    choices: [
      { key: 'A', text: 'Hired, borrowed, and employee-owned autos used for business' },
      { key: 'B', text: 'Only autos titled to the contractor' },
      { key: 'C', text: 'Only trailers listed on inland marine' },
      { key: 'D', text: 'Only comprehensive losses on owned vehicles' },
    ],
    answer: 'A',
    explanation: 'HNOA extends liability scope to non-owned and hired operational vehicle exposure.',
  },
  {
    id: 5,
    prompt: 'Which symbol provides the broadest liability trigger?',
    choices: [
      { key: 'A', text: 'Symbol 1' },
      { key: 'B', text: 'Symbol 7' },
      { key: 'C', text: 'Symbol 8 only' },
      { key: 'D', text: 'Symbol 9 only' },
    ],
    answer: 'A',
    explanation: 'Symbol 1 is the broadest liability trigger (Any Auto).',
  },
  {
    id: 6,
    prompt: 'What is the main limitation of Symbol 7?',
    choices: [
      { key: 'A', text: 'It applies to specifically described autos, so unscheduled units can be outside trigger' },
      { key: 'B', text: 'It includes all non-owned exposures automatically' },
      { key: 'C', text: 'It is only used for inland marine' },
      { key: 'D', text: 'It cannot be used with liability' },
    ],
    answer: 'A',
    explanation: 'Symbol 7 requires schedule precision; missing additions can produce no-trigger outcomes.',
  },
  {
    id: 7,
    prompt: 'Symbol 9 is most closely associated with:',
    choices: [
      { key: 'A', text: 'Employee-owned vehicles used in business (non-owned auto)' },
      { key: 'B', text: 'Owned autos only' },
      { key: 'C', text: 'Rented auto physical damage only' },
      { key: 'D', text: 'Trailer tool theft only' },
    ],
    answer: 'A',
    explanation: 'Symbol 9 is the common non-owned auto trigger in commercial auto design.',
  },
  {
    id: 8,
    prompt: 'Which statement about trailer coverage is most accurate?',
    choices: [
      { key: 'A', text: 'Trailer physical damage is not always automatic and must be validated' },
      { key: 'B', text: 'Trailer liability always includes all trailer physical damage by default' },
      { key: 'C', text: 'Trailers are never part of auto discussion' },
      { key: 'D', text: 'Trailer tools are always auto liability property' },
    ],
    answer: 'A',
    explanation: 'Trailer physical damage often requires explicit scheduling/endorsement confirmation.',
  },
  {
    id: 9,
    prompt: 'Tools stolen from inside trailers are commonly coordinated under:',
    choices: [
      { key: 'A', text: 'Inland marine/equipment structure' },
      { key: 'B', text: 'Auto liability only' },
      { key: 'C', text: 'HNOA only' },
      { key: 'D', text: 'Workers compensation' },
    ],
    answer: 'A',
    explanation: 'Equipment-in-transit and tool theft is usually an inland marine conversation.',
  },
  {
    id: 10,
    prompt: 'A strong advisor posture for contractor auto is to:',
    choices: [
      { key: 'A', text: 'Validate triggers, endorsements, and exposure fit before price-only comparisons' },
      { key: 'B', text: 'Assume all symbols and endorsements are equivalent' },
      { key: 'C', text: 'Skip HNOA review when no owned fleet exists' },
      { key: 'D', text: 'Ignore rental and loaner use patterns' },
    ],
    answer: 'A',
    explanation: 'Coverage architecture and trigger quality should be validated before premium-only positioning.',
  },
];

export default function ModuleTenAssessmentPage(): JSX.Element {
  const [answers, setAnswers] = useState<Partial<Record<number, Choice>>>({});
  const [submitted, setSubmitted] = useState(false);

  const score = useMemo(() => {
    return questions.reduce((total, question) => {
      return answers[question.id] === question.answer ? total + 1 : total;
    }, 0);
  }, [answers]);

  const allAnswered = questions.every((question) => answers[question.id] !== undefined);
  const passThreshold = 8;
  const passed = submitted && score >= passThreshold;

  return (
    <SectionLayout title="Module 10 Assessment">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 10 Assessment</span>
          <h1 className="text-3xl font-extrabold text-slate-900">Commercial Auto Mastery Check</h1>
          <p className="text-base leading-relaxed text-slate-700">
            Complete all 10 questions. A score of 8/10 or higher is the recommended benchmark.
          </p>
        </header>

        <section className="space-y-8">
          {questions.map((question) => {
            const selected = answers[question.id];
            const hasSelected = selected !== undefined;
            const isCorrect = selected === question.answer;

            return (
              <article key={question.id} className="rounded-xl border border-slate-200 bg-white p-6">
                <p className="mb-4 text-base font-semibold text-slate-900">
                  {question.id}. {question.prompt}
                </p>

                <div className="space-y-2">
                  {question.choices.map((choice) => {
                    const isActive = selected === choice.key;
                    return (
                      <button
                        key={`${question.id}-${choice.key}`}
                        type="button"
                        onClick={() => {
                          if (submitted) {
                            return;
                          }

                          setAnswers((current) => ({ ...current, [question.id]: choice.key }));
                        }}
                        className={`w-full rounded border p-3 text-left text-sm transition ${isActive ? 'border-slate-700 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-400'} ${submitted ? 'cursor-default' : ''}`}
                        disabled={submitted}
                      >
                        {choice.key}. {choice.text}
                      </button>
                    );
                  })}
                </div>

                {submitted && hasSelected ? (
                  <div className="mt-4 rounded border border-slate-100 bg-slate-50 p-4">
                    <p className={`mb-2 font-bold ${isCorrect ? 'text-emerald-700' : 'text-red-700'}`}>
                      {isCorrect ? 'Correct' : 'Incorrect'}
                    </p>
                    <p className="text-sm leading-relaxed text-slate-700">{question.explanation}</p>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>

        <section className="rounded-xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-xl font-bold text-slate-900">Submit Assessment</h2>
          <p className="mt-2 text-sm text-slate-700">
            Once submitted, your answers lock and explanations are revealed.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!allAnswered) {
                  return;
                }
                setSubmitted(true);
              }}
              disabled={!allAnswered || submitted}
              className={`rounded-lg px-6 py-3 text-sm font-semibold text-white ${!allAnswered || submitted ? 'cursor-not-allowed bg-slate-400' : 'bg-slate-950 hover:bg-slate-800'}`}
            >
              Submit
            </button>
            <a href="/learning/module/10/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Lesson 4</a>
          </div>

          {submitted ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-lg font-bold text-slate-900">
                Score: {score} / {questions.length}
              </p>
              <p className={`mt-2 font-semibold ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>
                {passed ? 'Benchmark met. You are ready to complete Module 10.' : 'Benchmark not met yet. Review lesson material and retry for stronger retention.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a href="/learning/module/10/complete" className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Completion</a>
                <a href="/learning/module/10/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Review Lessons</a>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SectionLayout>
  );
}
