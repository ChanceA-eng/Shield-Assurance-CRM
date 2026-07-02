'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SectionLayout from '../../../components/crm/SectionLayout';

interface WorkspaceResolution {
  leadId: string;
  clientId: string;
}

export default function LeadWorkspaceResolverPage(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();
  const leadId = searchParams.get('lead');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!leadId) {
      setError('Missing lead id. Open this page from the Leads queue.');
      return;
    }

    void (async () => {
      await fetch(`/api/leads/${leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Prospect' }),
      }).catch(() => null);

      const response = await fetch(`/api/leads/${leadId}/workspace`, { cache: 'no-store' });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({ message: 'Unable to open workspace.' }))) as { message?: string };
        setError(payload.message ?? 'Unable to open workspace.');
        return;
      }

      const data = (await response.json()) as WorkspaceResolution;
      router.replace(`/clients/${data.clientId}?lead=${data.leadId}`);
    })();
  }, [leadId, router]);

  return (
    <SectionLayout title="Client">
      <div className="rounded border border-[#dddbda] bg-white p-4 shadow-sm">
        {!error ? <p className="text-sm text-[#3e3e3c]">Opening client workspace...</p> : null}
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </div>
    </SectionLayout>
  );
}
