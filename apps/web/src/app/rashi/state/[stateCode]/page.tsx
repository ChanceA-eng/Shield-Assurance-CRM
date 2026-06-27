import SectionLayout from '../../../../components/crm/SectionLayout';
import RashiChatWorkspace from '../../../../components/rashi/rashi-chat-workspace';
import Link from 'next/link';

export default async function RashiStatePage({
  params,
}: {
  params: Promise<{ stateCode: string }>;
}): Promise<JSX.Element> {
  const { stateCode } = await params;
  const stateContext = stateCode.toUpperCase();

  return (
    <SectionLayout title={`Rashi · ${stateContext}`}>
      <nav className="mb-3 text-xs text-[#64748b]">
        <Link href="/rashi" className="text-[#0f62af] hover:underline">
          Rashi
        </Link>
        <span> · </span>
        <span>State · {stateContext}</span>
      </nav>
      <RashiChatWorkspace
        title={`${stateContext} Underwriting Chat`}
        description={`Conversational underwriting intelligence scoped to ${stateContext} guidance and requirements.`}
        scope={{ stateContext }}
      />
    </SectionLayout>
  );
}