'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

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
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 border-b border-cui-border/60 bg-white px-6 py-3 shadow-card">
        <h1 className="flex-1 text-xl font-bold tracking-tight text-cui-text">{title}</h1>
        {onModuleRoute ? (
          <a
            href={exitHref}
            className="inline-flex items-center rounded border border-cui-danger/40 bg-cui-danger/10 px-3 py-2 text-sm font-bold text-cui-danger transition hover:bg-cui-danger/20"
          >
            Exit
          </a>
        ) : null}
      </header>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
