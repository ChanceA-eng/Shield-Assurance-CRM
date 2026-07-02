import SectionLayout from '../../../components/crm/SectionLayout';
import RashiWorkspace from '../../../components/rashi/rashi-workspace';
import Link from 'next/link';
import type { Route } from 'next';

export default function RashiKnowledgePage(): JSX.Element {
  return (
    <SectionLayout title="Rashi Knowledge Manager">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Link
            href={'/rashi' as Route}
            className="flex items-center text-sm font-medium text-gray-400 transition-colors hover:text-gray-950"
            title="Back to Knowledge Center"
          >
            ← Back
          </Link>
        </div>

        <RashiWorkspace
          title="Rashi Knowledge Center"
          description="Manage ingestion, scoped tags, and knowledge assets for underwriting retrieval."
        />
      </div>
    </SectionLayout>
  );
}
