import React from 'react';

export const activityFilters = [
  ['all', 'All activity'],
  ['sending', 'Sending / interrupted'],
  ['acceptance_unknown', 'Acceptance uncertain'],
  ['accepted_by_provider', 'Accepted — recording incomplete'],
  ['sent', 'Accepted — recording complete'],
  ['failed', 'Legacy failed — review required'],
] as const;

export function DeliveryState({ status, busy, onFinish }: {
  status: string; busy: boolean; onFinish: () => void;
}): JSX.Element {
  const label = activityFilters.find(([value]) => value === status)?.[1] ?? status;
  const accepted = status === 'sent' || status === 'accepted_by_provider';
  return (
    <div className="space-y-1">
      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${accepted ? 'bg-cui-success/15 text-green-700' : 'bg-cui-warning/20 text-amber-800'}`}>
        {label}
      </span>
      <p className="text-xs text-cui-muted">
        {accepted
          ? 'Provider acceptance only; recipient delivery is not confirmed.'
          : 'Do not resend. Refresh first; if still unresolved, ask an administrator to reconcile this attempt with Gmail/SendGrid logs using the attempt ID and time.'}
      </p>
      {status === 'accepted_by_provider' ? (
        <button type="button" disabled={busy} onClick={onFinish}
          className="rounded border border-cui-primary px-2 py-1 text-xs font-semibold text-cui-primary disabled:opacity-60">
          {busy ? 'Recording…' : 'Finish recording — no resend'}
        </button>
      ) : null}
    </div>
  );
}
