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
    prompt: 'Workers compensation medical benefits generally include:',
    choices: [
      { key: 'A', text: 'Treatment care such as physician services, surgery, and prescriptions' },
      { key: 'B', text: 'Only liability settlements to third parties' },
      { key: 'C', text: 'Only trailer repair costs' },
      { key: 'D', text: 'Only vehicle replacement costs' },
    ],
    answer: 'A',
    explanation: 'Medical benefits are a core statutory component for covered work injuries.',
  },
  {
    id: 2,
    prompt: 'Employer Liability (Part B) is most relevant when:',
    choices: [
      { key: 'A', text: 'Lawsuit pathways arise around employee injury scenarios' },
      { key: 'B', text: 'Theft-only claims occur in transit' },
      { key: 'C', text: 'Auto symbol mismatch is identified' },
      { key: 'D', text: 'Only class codes need assignment' },
    ],
    answer: 'A',
    explanation: 'Part B addresses legal claims not fully resolved by statutory WC benefits alone.',
  },
  {
    id: 3,
    prompt: 'Class codes are used to determine:',
    choices: [
      { key: 'A', text: 'Risk category and pricing rate application in WC premium calculations' },
      { key: 'B', text: 'Only subcontractor legal names' },
      { key: 'C', text: 'Only auto liability limits' },
      { key: 'D', text: 'Only fleet maintenance schedules' },
    ],
    answer: 'A',
    explanation: 'Class codes map duties to risk rates in pricing formulas.',
  },
  {
    id: 4,
    prompt: 'In code assignment, insurers primarily evaluate:',
    choices: [
      { key: 'A', text: 'Actual duties and hazard profile, not just titles' },
      { key: 'B', text: 'Business card design quality' },
      { key: 'C', text: 'Office lease terms only' },
      { key: 'D', text: 'Customer concentration only' },
    ],
    answer: 'A',
    explanation: 'Code assignment is duty-based and audit sensitive.',
  },
  {
    id: 5,
    prompt: 'A mod below 1.00 generally indicates:',
    choices: [
      { key: 'A', text: 'Better-than-expected experience with favorable premium effect' },
      { key: 'B', text: 'No WC coverage in place' },
      { key: 'C', text: 'All claims are denied automatically' },
      { key: 'D', text: 'Class codes are irrelevant' },
    ],
    answer: 'A',
    explanation: 'Lower mod values typically correspond to favorable experience performance.',
  },
  {
    id: 6,
    prompt: 'Experience mods fundamentally compare:',
    choices: [
      { key: 'A', text: 'Actual claims versus expected claims for similar risk profiles' },
      { key: 'B', text: 'Payroll versus vehicle count' },
      { key: 'C', text: 'Auto liability versus property claims' },
      { key: 'D', text: 'Revenue versus tool inventory' },
    ],
    answer: 'A',
    explanation: 'Experience rating is based on actual versus expected loss performance.',
  },
  {
    id: 7,
    prompt: 'If a subcontractor lacks valid WC coverage, the contractor may:',
    choices: [
      { key: 'A', text: 'Incur transferred responsibility and audit payroll additions' },
      { key: 'B', text: 'Automatically avoid all premium impact' },
      { key: 'C', text: 'Have no documentation obligations' },
      { key: 'D', text: 'Transfer all loss instantly to auto policy' },
    ],
    answer: 'A',
    explanation: 'Uninsured subcontractor exposure can transfer cost and responsibility to the contractor.',
  },
  {
    id: 8,
    prompt: 'A ghost policy risk is best described as:',
    choices: [
      { key: 'A', text: 'Certificate appearance without reliable practical injury transfer protection' },
      { key: 'B', text: 'Mandatory full-coverage structure for all trades' },
      { key: 'C', text: 'A guaranteed zero-audit format' },
      { key: 'D', text: 'An auto-only policy extension' },
    ],
    answer: 'A',
    explanation: 'Ghost-policy scenarios can create false confidence and downstream transfer failure.',
  },
  {
    id: 9,
    prompt: 'Strong subcontractor verification includes checking:',
    choices: [
      { key: 'A', text: 'Active dates, matching legal entity, and state/jurisdiction accuracy' },
      { key: 'B', text: 'Logo quality and brand colors only' },
      { key: 'C', text: 'Only project timeline notes' },
      { key: 'D', text: 'Only a verbal confirmation call' },
    ],
    answer: 'A',
    explanation: 'Verification detail is essential to avoid coverage transfer failures.',
  },
  {
    id: 10,
    prompt: 'Best advisor posture for contractor WC is to:',
    choices: [
      { key: 'A', text: 'Treat WC as a claims, compliance, and transfer system, not payroll-only math' },
      { key: 'B', text: 'Treat WC as static pricing unrelated to operations' },
      { key: 'C', text: 'Ignore mod and class code quality' },
      { key: 'D', text: 'Defer all subcontractor checks until after audit' },
    ],
    answer: 'A',
    explanation: 'Field outcomes improve when advisors integrate coverage, compliance, and operational controls.',
  },
];

export default function ModuleElevenAssessmentPage(): JSX.Element {
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
    <SectionLayout title="Module 11 Assessment">
      <div className="mx-auto max-w-5xl space-y-10 px-6 py-14">
        <header className="space-y-3">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Module 11 Assessment</span>
          <h1 className="text-3xl font-extrabold text-slate-900">Advanced Workers Compensation Mastery Check</h1>
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
          <p className="mt-2 text-sm text-slate-700">Once submitted, your answers lock and explanations are revealed.</p>

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
            <a href="/learning/module/11/lesson/4" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Back to Lesson 4</a>
          </div>

          {submitted ? (
            <div className="mt-6 rounded-lg border border-slate-200 bg-white p-5">
              <p className="text-lg font-bold text-slate-900">Score: {score} / {questions.length}</p>
              <p className={`mt-2 font-semibold ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>
                {passed ? 'Benchmark met. You are ready to complete Module 11.' : 'Benchmark not met yet. Review lesson material and retry for stronger retention.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <a href="/learning/module/11/complete" className="rounded-lg bg-slate-950 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-800">Go to Completion</a>
                <a href="/learning/module/11/lesson/1" className="rounded-lg border border-slate-300 px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Review Lessons</a>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SectionLayout>
  );
}
