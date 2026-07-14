'use client';

import { useState } from 'react';

type Option = {
  key: string;
  label: string;
};

type InteractiveKnowledgeCheckProps = {
  question: string;
  options: Option[];
  correctKey: string;
  explanation: string;
};

export default function InteractiveKnowledgeCheck({
  question,
  options,
  correctKey,
  explanation,
}: InteractiveKnowledgeCheckProps): JSX.Element {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const hasSelection = selectedKey !== null;
  const isCorrect = selectedKey === correctKey;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-slate-500">Knowledge Check</h2>
      <h3 className="mb-4 text-lg font-bold text-slate-900">{question}</h3>

      <div className="space-y-3">
        {options.map((option) => {
          const isSelected = selectedKey === option.key;

          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setSelectedKey(option.key)}
              className={`w-full rounded border p-4 text-left text-sm transition ${isSelected ? 'border-slate-700 bg-slate-50 font-semibold text-slate-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
            >
              {option.key}. {option.label}
            </button>
          );
        })}
      </div>

      {hasSelection ? (
        <div className="mt-6 rounded border border-slate-100 bg-slate-50 p-5">
          <p className={`mb-2 font-bold ${isCorrect ? 'text-emerald-700' : 'text-red-700'}`}>{isCorrect ? 'Correct' : 'Incorrect'}</p>
          <p className="text-sm leading-relaxed text-slate-700">{explanation}</p>
        </div>
      ) : null}
    </section>
  );
}
