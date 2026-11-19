'use client';

import { useEffect, useRef, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';

export type EmailProviderChoice = 'default' | 'gmail';

interface GmailStatus {
  connection: { email: string; status: string; sync_enabled: boolean } | null;
}

export default function EmailProviderControl({
  value, onChange, disabled, compact = false,
}: {
  value: EmailProviderChoice;
  onChange: (provider: EmailProviderChoice) => void;
  disabled: boolean;
  compact?: boolean;
}): JSX.Element {
  const [connection, setConnection] = useState<GmailStatus['connection']>(null);
  const [statusError, setStatusError] = useState('');
  const userSelected = useRef(false);

  useEffect(() => {
    let active = true;
    void workspaceFetch<GmailStatus>('/api/gmail').then((result) => {
      if (!active) return;
      setConnection(result.connection);
      setStatusError('');
      if (result.connection?.status === 'connected' && value === 'default' && !userSelected.current) onChange('gmail');
    }).catch((failure: unknown) => {
      if (active) setStatusError(failure instanceof Error ? failure.message : 'Gmail connection status is unavailable.');
    });
    return () => { active = false; };
  }, []);

  return <div className="min-w-0 max-w-full space-y-1">
    <label className={`block text-xs font-semibold text-cui-muted ${compact ? 'flex items-center gap-2' : ''}`}>
      <span className={compact ? 'sr-only' : ''}>Send from</span>
      <select value={value} onChange={(event) => {
        if (event.target.value === 'default' || event.target.value === 'gmail') {
          userSelected.current = true;
          onChange(event.target.value);
        }
      }} disabled={disabled}
        className={`${compact ? 'max-w-full py-1 text-xs' : 'mt-1 w-full py-2 text-sm'} rounded border border-cui-border bg-white px-3 text-cui-text disabled:opacity-60`}>
        <option value="default">Agency email</option>
        <option value="gmail">{connection?.email ? `My Gmail (${connection.email})` : 'My Gmail'}</option>
      </select>
    </label>
    {statusError ? <p role="alert" className="text-xs text-cui-danger">{statusError}</p> : null}
  </div>;
}
