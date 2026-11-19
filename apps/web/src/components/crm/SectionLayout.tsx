'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';

/**
 * Standard page content wrapper: CoreUI-style page header plus content area.
 * The global sidebar and header are provided by AppShell in the root layout.
 */
export default function SectionLayout({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  const pathname = usePathname();

  const pathParts = pathname.split('/').filter(Boolean);
  const moduleIndex = pathParts.indexOf('module');
  const moduleId = moduleIndex >= 0 ? pathParts[moduleIndex + 1] : null;
  const onModuleRoute = pathname.startsWith('/learning/module/') && Boolean(moduleId);
  const onModuleOverview = onModuleRoute && pathname === `/learning/module/${moduleId}`;
  const exitHref = onModuleOverview
    ? '/learning/course/contractor-insurance-fundamentals/overview'
    : `/learning/module/${moduleId}`;

  return (
    <div className="flex min-h-full min-w-0 flex-col" data-crm-page>
      <header className="flex min-h-16 flex-wrap items-center gap-3 border-b border-cui-border bg-cui-panel px-4 py-4 md:px-6">
        <span className="h-7 w-1 rounded-full bg-cui-primary" aria-hidden="true" />
        <h1 className="min-w-0 flex-1 text-2xl font-bold tracking-tight text-cui-text">{title}</h1>
        {onModuleRoute ? (
          <Link
            href={exitHref as Route}
            className="crm-button-danger"
          >
            Exit
          </Link>
        ) : null}
      </header>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
