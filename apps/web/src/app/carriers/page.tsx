import type { Route } from 'next';
import { redirect } from 'next/navigation';

export default function CarriersPage(): never {
  redirect('/rashi' as Route);
}
