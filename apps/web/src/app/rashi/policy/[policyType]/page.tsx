import SectionLayout from '../../../../components/crm/SectionLayout';
import RashiChatWorkspace from '../../../../components/rashi/rashi-chat-workspace';
import Link from 'next/link';

function normalizePolicyType(value: string): string {
  return value.replace(/-/g, ' ').toUpperCase();
}

export default async function RashiPolicyPage({
  params,
}: {
  params: Promise<{ policyType: string }>;
}): Promise<JSX.Element> {
  const { policyType } = await params;
  const normalizedPolicyType = normalizePolicyType(policyType);

  return (
    <SectionLayout title={`Rashi · ${normalizedPolicyType}`}>
      <nav className="mb-3 text-xs text-[#64748b]">
        <Link href="/rashi" className="text-[#0f62af] hover:underline">
          Rashi
        </Link>
        <span> · </span>
        <span>Policy · {normalizedPolicyType}</span>
      </nav>
      <RashiChatWorkspace
        title={`${normalizedPolicyType} Underwriting Chat`}
        description={`Conversational underwriting intelligence scoped to ${normalizedPolicyType} rules and endorsements.`}
        scope={{ policyType: normalizedPolicyType }}
      />
    </SectionLayout>
  );
}