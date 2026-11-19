'use client';
import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';
export default function AgentSenderBadge(): JSX.Element | null {
  const [sender, setSender] = useState<{ enabled: boolean; name: string; email: string | null; status: string } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void workspaceFetch<NonNullable<typeof sender>>('/api/agency/sender')
      .then((data) => { if (active) setSender(data); })
      .catch((failure: unknown) => { if (active) setError(failure instanceof Error ? failure.message : 'Sending identity could not be verified.'); });
    return () => { active = false; };
  }, []);
  if (error) return <p role="alert" className="mb-2 text-xs text-cui-danger">{error} Check your agent profile and Gmail in My Account.</p>;
  if (!sender?.enabled) return null;
  return <p className="mb-2 text-xs text-cui-muted">From: {sender.name} {sender.email ? `<${sender.email}>` : '(connect Gmail in My Account)'} · {sender.status}. No shared-sender fallback.</p>;
}
