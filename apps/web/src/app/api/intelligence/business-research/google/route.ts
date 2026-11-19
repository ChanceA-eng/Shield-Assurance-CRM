import { NextRequest, NextResponse } from 'next/server';
import { EMPTY_BUSINESS_SEARCH, type BusinessResearchProfile, type GooglePlace } from '@crm/shared';
import { getApiSession } from '../../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../../lib/supabase-server';
import { workspaceApiError, workspaceBody } from '../../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../../lib/record-scope';
import { linkGooglePlaces, researchReadiness } from '../../../../../lib/business-research-server';
import { liveResearch, TRANSIENT_OSHA_GAP, type ResearchEvidence } from '../../../../../lib/business-research-jobs';
import { googlePlaceInput } from '../../../../../lib/google-places';
import { googleAddress } from '../../../../../lib/google-match';

export const runtime = 'nodejs';
export const maxDuration = 60;

const CACHE_MS = 3600000;
const profiles = new Map<string, { at: number; profile: BusinessResearchProfile }>();

function evidence(place: GooglePlace): ResearchEvidence {
  const address = googleAddress(place.address);
  return {
    source: 'google', url: place.maps_url ?? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.id)}`,
    values: { name: place.name, street: address.street, city: address.city, state: address.state, zip: address.zip, phone: place.phone,
      email: null, website: place.website, latitude: place.latitude, longitude: place.longitude, industry: place.category, naics: null,
      classification: 'mapped', dot: null, ein: null, power_units: null, drivers: null, registration_reported_on: null, filing_year: null,
      assets: null, revenue: null },
  };
}

/** Opens a Google Maps listing in the OIP: links it to a matching public record, or researches it live without storing Google content. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    const body = await workspaceBody(request);
    const place = googlePlaceInput(body.place), address = googleAddress(place.address);
    if (address.state) {
      const [record] = await linkGooglePlaces(db, session.user.id, [place], { ...EMPTY_BUSINESS_SEARCH, state: address.state, city: address.city ?? '' })
        .catch((error: unknown) => { console.error('[business-research:google-link]', error); return []; });
      if (record) return NextResponse.json({ business_id: record.id }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const cached = profiles.get(place.id);
    if (cached && cached.at > Date.now() - CACHE_MS) return NextResponse.json({ profile: cached.profile }, { headers: { 'Cache-Control': 'no-store' } });
    const external = await liveResearch(db, [evidence(place)]);
    const profile: BusinessResearchProfile = {
      business: { id: `google:${place.id}`, name: place.name, observations: [], status: 'partial', updated_at: new Date().toISOString(), google: place },
      linked_record: null,
      job: { state: 'complete', error: null, result: { insights: [], market_fit: null, ...external } },
      readiness: await researchReadiness(db),
    };
    // Profiles still waiting on a rate-limited OSHA check are not cached, so reopening retries the lookup.
    if (!external.coverage.some((item) => item.state === 'unavailable' && TRANSIENT_OSHA_GAP.test(item.message))) {
      profiles.set(place.id, { at: Date.now(), profile });
      if (profiles.size > 300) profiles.delete(profiles.keys().next().value ?? '');
    }
    return NextResponse.json({ profile }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return workspaceApiError(error, 'intelligence/business-research-google'); }
}
