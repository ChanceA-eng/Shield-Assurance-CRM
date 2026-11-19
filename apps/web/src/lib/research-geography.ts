import { RESEARCH_PLACES } from '../data/research-places-2026';
import type { ResearchPlace } from '@crm/shared';
import { WorkspaceError } from './record-scope';

const states = RESEARCH_PLACES;
export function researchPlaces(state: string): ResearchPlace[] {
  if (!Object.prototype.hasOwnProperty.call(states, state)) throw new WorkspaceError('City choices are available for the 50 states, DC and Puerto Rico.', 400);
  return states[state];
}
export function researchPlace(state: string, id: string): ResearchPlace {
  const place = researchPlaces(state).find((item) => item.id === id);
  if (!place) throw new WorkspaceError('Choose a city belonging to the selected state.', 400);
  return place;
}

export interface Point { latitude: number; longitude: number }
export function milesBetween(a: Point, b: Point): number {
  const rad = Math.PI / 180, dLat = (b.latitude - a.latitude) * rad, dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function radiusCenter(filters: { state: string; place_id: string; radius_miles: string }): (Point & { radius_miles: number }) | null {
  if (!filters.radius_miles || !filters.place_id || !filters.state) return null;
  const place = researchPlace(filters.state, filters.place_id);
  return { latitude: place.latitude, longitude: place.longitude, radius_miles: Number(filters.radius_miles) };
}
/** Uppercase names of the selected state's cities whose centers fall inside the radius, nearest first, for sources that only report a city. */
export function radiusCities(filters: { state: string; place_id: string; radius_miles: string }, limit = 150): string[] | null {
  const center = radiusCenter(filters);
  if (!center) return null;
  return researchPlaces(filters.state).map((place) => ({ name: place.name.toUpperCase(), miles: milesBetween(center, place) }))
    .filter((place) => place.miles <= center.radius_miles).sort((a, b) => a.miles - b.miles).slice(0, limit).map((place) => place.name)
    .filter((name, index, names) => names.indexOf(name) === index);
}
