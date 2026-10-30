import React from 'react';
import clsx from 'clsx';

export function Card({ className, children }: { className?: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className={clsx('rounded border border-cui-border/60 bg-white shadow-card', className)}>{children}</div>
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
        'flex items-center justify-between gap-3 border-b border-cui-border/60 bg-cui-light px-4 py-2.5',
        className,
      )}
    >
      <h2 className="text-sm font-semibold text-cui-text">{children}</h2>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }): JSX.Element {
  return <div className={clsx('p-4', className)}>{children}</div>;
}
