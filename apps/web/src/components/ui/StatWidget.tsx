import Link from 'next/link';
import type { Route } from 'next';
import React from 'react';
import clsx from 'clsx';

export type StatWidgetColor = 'primary' | 'info' | 'warning' | 'danger' | 'success';

const colorClasses: Record<StatWidgetColor, string> = {
  primary: 'bg-cui-primary',
  info: 'bg-cui-info',
  warning: 'bg-cui-warning',
  danger: 'bg-cui-danger',
  success: 'bg-cui-success',
};

interface StatWidgetProps {
  label: string;
  value: string;
  color: StatWidgetColor;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
  footer?: React.ReactNode;
}

/**
 * CoreUI-style colored stat widget: large value, label, watermark icon,
 * optional footer row (for example a progress bar or hint text).
 */
export default function StatWidget({ label, value, color, icon: Icon, href, footer }: StatWidgetProps): JSX.Element {
  const body = (
    <div
      className={clsx(
        'relative flex h-full min-h-[118px] flex-col overflow-hidden rounded p-4 text-white shadow-card transition hover:brightness-105',
        colorClasses[color],
      )}
    >
      <Icon className="absolute -right-2 -top-2 h-16 w-16 opacity-20" />
      <p className="text-2xl font-bold leading-tight">{value}</p>
      <p className="mt-0.5 text-sm text-white/80">{label}</p>
      {footer ? <div className="mt-auto pt-3">{footer}</div> : null}
    </div>
  );

  if (href) {
    return (
      <Link href={href as Route} className="block h-full">
        {body}
      </Link>
    );
  }

  return body;
}
