'use client';

import { useEffect, useState } from 'react';
import { isAgencyTimeZone, type AgencyTimeZone } from '../lib/agency-time';

export function useAgencyTimeZone(): { timeZone: AgencyTimeZone | null; error: string | null } {
  const [timeZone, setTimeZone] = useState<AgencyTimeZone | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void fetch('/api/agency/time-zone', { cache: 'no-store' }).then(async (response) => {
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
        ? body.message : 'Agency time zone could not be loaded.');
      if (typeof body !== 'object' || body === null || !('time_zone' in body) || !isAgencyTimeZone(body.time_zone)) {
        throw new Error('Agency time zone response was invalid.');
      }
      if (active) setTimeZone(body.time_zone);
    }).catch((failure: unknown) => {
      if (active) setError(failure instanceof Error ? failure.message : 'Agency time zone could not be loaded.');
    });
    return () => { active = false; };
  }, []);
  return { timeZone, error };
}
