import type { Metadata } from 'next';
import ProspectQuestionnaire from './ProspectQuestionnaire';

export const metadata: Metadata = { title: 'Shield Assurance Secure Intake', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function Page({ params }: { params: Promise<{ token: string }> }): Promise<JSX.Element> {
  const { token } = await params;
  return <ProspectQuestionnaire token={token} />;
}
