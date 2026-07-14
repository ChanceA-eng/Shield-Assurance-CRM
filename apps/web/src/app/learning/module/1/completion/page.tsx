import { redirect } from 'next/navigation';

export default function ModuleOneCompletionPage(): JSX.Element {
  redirect('/learning/module/1/complete');
}
