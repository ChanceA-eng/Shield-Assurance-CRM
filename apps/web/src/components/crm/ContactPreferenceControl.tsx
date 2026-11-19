'use client';

import { useEffect, useState } from 'react';
import { workspaceFetch } from '../../lib/workspace-fetch';

export default function ContactPreferenceControl({ type, id, onValue, onSaved }: {
  type: 'lead' | 'client';
  id: string;
  onValue?: (value: boolean) => void;
  onSaved?: () => void;
}): JSX.Element {
  const [doNotContact, setDoNotContact] = useState(false);
  const [inherited, setInherited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setDoNotContact(true);
    setInherited(false);
    onValue?.(true);
    setError('');
    void workspaceFetch<{ do_not_contact: boolean; inherited: boolean }>(
      `/api/record-contact-preference?type=${type}&id=${encodeURIComponent(id)}`,
    ).then((value) => {
      if (!active) return;
      setDoNotContact(value.do_not_contact);
      setInherited(value.inherited);
      setLoaded(true);
      onValue?.(value.do_not_contact);
    }).catch((failure: unknown) => {
      if (active) {
        setDoNotContact(true);
        onValue?.(true);
        setError(failure instanceof Error ? failure.message : 'Contact preference could not be loaded.');
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [type, id, onValue]);

  const clearRestriction = async (): Promise<void> => {
    const previous = doNotContact;
    setBusy(true);
    setError('');
    try {
      const saved = await workspaceFetch<{ do_not_contact: boolean; inherited: boolean }>('/api/record-contact-preference', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, do_not_contact: false }),
      });
      setDoNotContact(saved.do_not_contact);
      setInherited(saved.inherited);
      onValue?.(saved.do_not_contact);
      onSaved?.();
    } catch (failure) {
      setDoNotContact(previous);
      onValue?.(previous);
      setError(failure instanceof Error ? failure.message : 'Contact preference could not be saved.');
    } finally { setBusy(false); }
  };

  if (loading && !error) return <p className="text-xs text-cui-muted">Checking contact preferences...</p>;
  if (!doNotContact && !error) return <></>;
  return (
    <div className="rounded border border-cui-danger/40 bg-cui-danger/5 px-3 py-2 text-sm">
      {doNotContact && loaded ? (
        <>
          <p>Contact is restricted{inherited ? ' on a linked record' : ''}. Review the contact&apos;s preference before proceeding.</p>
          {!inherited ? <button type="button" className="mt-2 text-cui-primary underline" disabled={busy}
            onClick={() => void clearRestriction()}>Clear restriction</button> : null}
        </>
      ) : null}
      {error ? <p role="alert" className="text-xs text-cui-danger">{error}</p> : null}
    </div>
  );
}
