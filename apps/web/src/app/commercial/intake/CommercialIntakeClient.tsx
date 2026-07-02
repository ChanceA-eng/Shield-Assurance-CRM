'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import SectionLayout from '../../../components/crm/SectionLayout';
import IntakeForm, { type IntakeInsights } from './IntakeForm';
import UnderwritingPanel from './UnderwritingPanel';

export default function CommercialIntakeClient(): JSX.Element {
  const searchParams = useSearchParams();
  const accountId = searchParams.get('id');
  const [insights, setInsights] = useState<IntakeInsights | null>(null);

  return (
    <SectionLayout title="Commercial Intake">
      <div className="flex h-full min-h-[70vh] gap-4">
        <div className="flex-1 overflow-y-auto rounded border border-[#dddbda] bg-white p-4 shadow-sm">
          <h2 className="mb-1 text-lg font-bold text-[#080707]">Commercial Intake Workspace</h2>
          <p className="mb-4 text-sm text-[#3e3e3c]">Capture underwriting-ready risk intake before moving prospects into client and policy workflows.</p>
          <IntakeForm onInsightsChange={setInsights} />
        </div>
        <UnderwritingPanel
          accountId={accountId}
          initialCompletenessScore={insights?.completenessScore ?? 0}
          initialCarrierMatrix={insights?.carrierMatrix ?? {}}
          underwritingFlags={insights?.underwritingFlags ?? []}
        />
      </div>
    </SectionLayout>
  );
}