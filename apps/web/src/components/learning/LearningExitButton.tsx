'use client';

import { usePathname } from 'next/navigation';

function getModuleId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  const moduleIndex = parts.indexOf('module');

  if (moduleIndex === -1) {
    return null;
  }

  return parts[moduleIndex + 1] ?? null;
}

function isModuleOverview(pathname: string, moduleId: string): boolean {
  return pathname === `/learning/module/${moduleId}`;
}

export default function LearningExitButton(): JSX.Element | null {
  const pathname = usePathname();
  const moduleId = getModuleId(pathname);

  if (!moduleId) {
    return null;
  }

  const onOverview = isModuleOverview(pathname, moduleId);
  const href = onOverview
    ? '/learning/course/contractor-insurance-fundamentals/overview'
    : `/learning/module/${moduleId}`;
  const label = onOverview ? 'Exit to Course Overview' : 'Exit to Module Overview';

  return (
    <div className="mx-auto flex w-full max-w-5xl justify-end px-6 pt-6">
      <a
        href={href}
        className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
      >
        {label}
      </a>
    </div>
  );
}
