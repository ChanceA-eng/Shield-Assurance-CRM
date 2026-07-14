import { redirect } from 'next/navigation';

export default function ModuleOneKnowledgeCheckPage(): JSX.Element {
  redirect('/learning/module/1/assessment');
}
