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
    prompt: 'Which statement best describes standard BOP positioning for contractors?',
    choices: [
      { key: 'A', text: 'Bundled core structure often suited to qualifying lower-complexity operations' },
      { key: 'B', text: 'Primary form for every high-hazard industrial operation' },
      { key: 'C', text: 'Replacement for all specialty construction lines' },
      { key: 'D', text: 'Coverage model only for personal lines clients' },
    ],
    answer: 'A',
    explanation: 'BOP typically supports qualifying smaller and lower-complexity commercial operations.',
  },
  {
    id: 2,
    prompt: 'What is the defining strength of CPP?',
    choices: [
      { key: 'A', text: 'Modular coverage architecture with greater customization flexibility' },
      { key: 'B', text: 'Automatic lowest premium in all cases' },
      { key: 'C', text: 'Guaranteed zero exclusions' },
      { key: 'D', text: 'No underwriting review needed' },
    ],
    answer: 'A',
    explanation: 'CPP allows selected coverage parts and endorsements to match complex exposure profiles.',
  },
  {
    id: 3,
    prompt: 'Which factor is most relevant to eligibility decisions?',
    choices: [
      { key: 'A', text: 'Operational complexity and hazard class' },
      { key: 'B', text: 'Office paint color' },
      { key: 'C', text: 'Website font preference' },
      { key: 'D', text: 'Vehicle music playlist' },
    ],
    answer: 'A',
    explanation: 'Eligibility commonly reflects operation type, hazard, size, controls, and claims profile.',
  },
  {
    id: 4,
    prompt: 'Which line is commonly outside default BOP assumptions for many contractors?',
    choices: [
      { key: 'A', text: 'Specialty construction exposure needing dedicated structure' },
      { key: 'B', text: 'Any basic liability component' },
      { key: 'C', text: 'All property coverage always' },
      { key: 'D', text: 'Any claims handling process' },
    ],
    answer: 'A',
    explanation: 'Specialty or higher-hazard exposures often require broader customization and separate line handling.',
  },
  {
    id: 5,
    prompt: 'What does carrier appetite mean in practical placement terms?',
    choices: [
      { key: 'A', text: 'A carrier\'s willingness to write classes under specific conditions' },
      { key: 'B', text: 'Permanent acceptance of all trades' },
      { key: 'C', text: 'No variation across market cycles' },
      { key: 'D', text: 'Only a marketing concept' },
    ],
    answer: 'A',
    explanation: 'Appetite shifts based on strategy, losses, reinsurance, and class performance.',
  },
  {
    id: 6,
    prompt: 'Which is a strong fit-first client advisory approach?',
    choices: [
      { key: 'A', text: 'Map risk profile first, then compare structure options' },
      { key: 'B', text: 'Discuss premium only and skip exposure mapping' },
      { key: 'C', text: 'Select structure before underwriting review' },
      { key: 'D', text: 'Ignore contract requirements' },
    ],
    answer: 'A',
    explanation: 'Fit-first sequencing improves adequacy and supports durable placement decisions.',
  },
  {
    id: 7,
    prompt: 'Why might a growing contractor transition from BOP toward CPP?',
    choices: [
      { key: 'A', text: 'Complexity and specialty needs outgrow bundled guardrails' },
      { key: 'B', text: 'Because BOP is illegal for all growth accounts' },
      { key: 'C', text: 'Because CPP removes underwriting completely' },
      { key: 'D', text: 'Because endorsements are no longer needed' },
    ],
    answer: 'A',
    explanation: 'Growth often increases exposure breadth, making modular package design more appropriate.',
  },
  {
    id: 8,
    prompt: 'Which objection response is strongest when CPP appears more complex?',
    choices: [
      { key: 'A', text: 'Complex design can reduce claim-time mismatch and coverage gaps' },
      { key: 'B', text: 'Complexity does not matter at all' },
      { key: 'C', text: 'Skip explanation and finalize quickly' },
      { key: 'D', text: 'Assume all terms are equivalent' },
    ],
    answer: 'A',
    explanation: 'Explaining risk alignment and claim reliability improves acceptance of structured complexity.',
  },
  {
    id: 9,
    prompt: 'Which market context trend supports careful package selection?',
    choices: [
      { key: 'A', text: 'Persistent contractor property and liability loss pressure' },
      { key: 'B', text: 'Guaranteed universal rate decreases every year' },
      { key: 'C', text: 'End of underwriting selectivity' },
      { key: 'D', text: 'No need for documentation quality' },
    ],
    answer: 'A',
    explanation: 'Rising loss pressure increases the cost of structure mismatch and poor exposure presentation.',
  },
  {
    id: 10,
    prompt: 'What is the best summary of advisor posture in BOP vs CPP decisions?',
    choices: [
      { key: 'A', text: 'Treat structure as risk architecture aligned to operations and contracts' },
      { key: 'B', text: 'Treat structure as a formality after price selection' },
      { key: 'C', text: 'Treat structure as unrelated to claims outcomes' },
      { key: 'D', text: 'Treat structure as fixed forever regardless of growth' },
    ],
    answer: 'A',
    explanation: 'Policy structure should be framed as strategic risk design, not administrative preference.',
  },
];

export default function ModuleNineAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 9 Assessment">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 9 Assessment</span>
          <h1 className="text-3xl font-extrabold text-slate-900">BOP and CPP Mastery Check</h1>
          <p className="text-base leading-relaxed text-slate-700">
            Complete all 10 questions. A score of 8/10 or higher is the recommended benchmark.
          </p>
        </header>

        <div className="flex h-52 w-full items-center justify-center rounded-lg bg-slate-200 text-center text-sm italic text-slate-600">
          [Image Placeholder: Assessment Dashboard - BOP and CPP]
        </div>

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
            <a href="/learning/module/9/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Lesson 4</a>
          </div>

          {submitted ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-lg font-bold text-slate-900">
                Score: {score} / {questions.length}
              </p>
              <p className={`mt-2 font-semibold ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>
                {passed ? 'Benchmark met. You are ready to complete Module 9.' : 'Benchmark not met yet. Review lesson material and retry for stronger retention.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a href="/learning/module/9/complete" className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Completion</a>
                <a href="/learning/module/9/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Review Lessons</a>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SectionLayout>
  );
}
