import type { BusinessObservation, GooglePlace } from '@crm/shared';
import { milesBetween } from './research-geography';

const SUFFIXES = /\b(the|llc|l l c|inc|incorporated|co|corp|corporation|company|ltd|limited|lp|llp|pllc|pc|dba|and|of)\b/g;
export function businessNameKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]/g, ' ').replace(SUFFIXES, ' ').replace(/\s+/g, '');
}
const digits = (value: string | null | undefined): string => (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');

export interface GoogleAddress { number: string | null; zip: string | null; city: string | null; state: string | null; street: string | null }
/** Parses Google's US formatted address, e.g. "1234 N Main St, Tucson, AZ 85705, USA". */
export function googleAddress(value: string | null): GoogleAddress {
  const parts = (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts[parts.length - 1] === 'USA') parts.pop();
  const region = parts.length >= 3 ? /^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/.exec(parts[parts.length - 1]) : null;
  const street = region ? parts[parts.length - 3] : parts[0] ?? null;
  return { street: street ?? null, number: /^\d+/.exec(street ?? '')?.[0] ?? null, zip: region?.[2] ?? null,
    city: region ? parts[parts.length - 2] : null, state: region?.[1] ?? null };
}

function namesAgree(a: string, b: string): boolean {
  const left = businessNameKey(a), right = businessNameKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const [short, long] = left.length < right.length ? [left, right] : [right, left];
  return short.length >= 5 && long.includes(short);
}

/** True when a Google listing and a public record describe the same establishment: an identical phone, or an agreeing name plus a matching ZIP, street number or nearby point. */
export function googleMatchesRecord(place: GooglePlace, observations: Array<Pick<BusinessObservation, 'values'>>): boolean {
  const address = googleAddress(place.address), phone = digits(place.phone);
  return observations.some(({ values }) => {
    if (phone.length === 10 && digits(values.phone) === phone) return true;
    if (!namesAgree(place.name, values.name)) return false;
    if (address.zip && values.zip?.slice(0, 5) === address.zip) return true;
    if (address.number && /^\d+/.exec(values.street ?? '')?.[0] === address.number) return true;
    return place.latitude !== null && place.longitude !== null && values.latitude !== null && values.longitude !== null
      && milesBetween({ latitude: place.latitude, longitude: place.longitude }, { latitude: values.latitude, longitude: values.longitude }) <= 0.25;
  });
}
