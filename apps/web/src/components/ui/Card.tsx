import React from 'react';
import clsx from 'clsx';

export function Card({ className, children }: { className?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={clsx('min-w-0 rounded-xl border border-cui-border bg-cui-panel shadow-card', className)}>{children}</div>
  );
}

export function CardHeader({
  className,
  children,
  actions,
}: {
  className?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}): JSX.Element {
  return (
    <div
      className={clsx(
        'flex flex-wrap items-center justify-between gap-3 rounded-t-xl border-b border-cui-border bg-cui-light/60 px-4 py-3',
        className,
      )}
    >
      <h2 className="text-sm font-bold text-cui-text">{children}</h2>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }): JSX.Element {
  return <div className={clsx('p-4', className)}>{children}</div>;
}
