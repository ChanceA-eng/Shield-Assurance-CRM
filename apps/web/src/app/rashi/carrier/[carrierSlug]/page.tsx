import SectionLayout from '../../../../components/crm/SectionLayout';
import RashiChatWorkspace from '../../../../components/rashi/rashi-chat-workspace';
import Link from 'next/link';

function unslugify(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default async function RashiCarrierPage({
  params,
}: {
  params: Promise<{ carrierSlug: string }>;
}): Promise<JSX.Element> {
  const { carrierSlug } = await params;
  const carrierName = unslugify(carrierSlug);

  return (
    <SectionLayout title={`Rashi · ${carrierName}`}>
      <nav className="mb-3 text-xs text-[#73818f]">
        <Link href="/rashi" className="text-[#167495] hover:underline">
          Rashi
        </Link>
        <span> · </span>
        <span>Carrier · {carrierName}</span>
      </nav>
      <RashiChatWorkspace
        title={`${carrierName} Underwriting Chat`}
        description={`Conversational intelligence scoped to ${carrierName} appetite, exclusions, eligibility, and coverage rules.`}
        scope={{ carrierName }}
      />
    </SectionLayout>
  );
}