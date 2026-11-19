import Questionnaire from './Questionnaire';
export const metadata = { title: 'Business insurance discovery', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function Page({ params }: { params: Promise<{ token: string }> }): Promise<JSX.Element> {
  const { token } = await params;
  return <Questionnaire token={token} />;
}
