import { redirect } from 'next/navigation';

export default function EventsPage(): never {
  redirect('/scheduler?view=list');
}
