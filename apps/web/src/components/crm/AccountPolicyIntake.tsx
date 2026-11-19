'use client';

import React, { createContext, useContext, useRef, useState } from 'react';
import PolicyDocumentIntake, { type ReviewedIntakeFields } from './PolicyDocumentIntake';
import type { LocalIntakeDocument } from '../../lib/policy-document-intake';

interface IntakeContextValue {
  fields: ReviewedIntakeFields;
  documents: LocalIntakeDocument[];
  setSaving: (saving: boolean) => void;
  uploadedDocuments: Map<string, string>;
}
const IntakeContext = createContext<IntakeContextValue | null>(null);
export const useIntakeDocuments = (): IntakeContextValue => {
  const context = useContext(IntakeContext);
  if (!context) throw new Error('Document intake requires AccountPolicyIntake.');
  return context;
};

export default function AccountPolicyIntake({ intent, children, onReviewed, disabled = false, uploadedDocuments }: {
  intent: 'account' | 'policy';
  children: React.ReactNode;
  onReviewed?: (fields: ReviewedIntakeFields, documents: LocalIntakeDocument[]) => void;
  disabled?: boolean;
  uploadedDocuments?: Map<string, string>;
}): JSX.Element {
  const [fields, setFields] = useState<ReviewedIntakeFields>({});
  const [documents, setDocuments] = useState<LocalIntakeDocument[]>([]);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const localUploads = useRef(new Map<string, string>());
  const title = intent === 'account' ? 'New Account' : 'New Policy';
  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
    <section role="dialog" aria-modal="true" aria-label={title}
      className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded border border-cui-border bg-white p-4 shadow-xl">
      <h2 className="mb-3 text-lg font-bold text-cui-text">{title}</h2>
      <PolicyDocumentIntake disabled={disabled || saving} onProcessingChange={setProcessing} onSourcesChanged={() => {
        setFields({}); setDocuments([]); onReviewed?.({}, []);
      }} onReviewed={(values, files) => {
        setFields(values); setDocuments(files); onReviewed?.(values, files);
      }} />
      <IntakeContext.Provider value={{ fields, documents, setSaving, uploadedDocuments: uploadedDocuments ?? localUploads.current }}>
        <fieldset disabled={disabled || saving || processing} className="min-w-0">{children}</fieldset>
      </IntakeContext.Provider>
    </section>
  </div>;
}
