import Link from 'next/link';
import type { Route } from 'next';
import { Construction, ArrowRight } from 'lucide-react';
import SectionLayout from './SectionLayout';
import { Card, CardBody } from '../ui/Card';

export default function UnavailableFeature({
  title, description, href, action,
}: { title: string; description: string; href: Route; action: string }): JSX.Element {
  return (
    <SectionLayout title={title}>
      <Card className="mx-auto max-w-2xl">
        <CardBody>
          <div className="flex items-start gap-4">
            <span className="rounded-xl bg-cui-warning/20 p-3 text-amber-700"><Construction className="h-6 w-6" /></span>
            <div className="space-y-3">
              <span className="rounded-full bg-cui-light px-2.5 py-1 text-xs font-semibold text-cui-muted">Not available in this release</span>
              <h2 className="text-xl font-bold text-cui-text">{title}</h2>
              <p className="text-sm leading-6 text-cui-muted">{description}</p>
              <Link href={href} className="inline-flex items-center gap-2 rounded bg-cui-primary px-4 py-2 text-sm font-semibold text-white">
                {action}<ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </CardBody>
      </Card>
    </SectionLayout>
  );
}
