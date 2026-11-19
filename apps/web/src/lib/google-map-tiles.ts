import { googlePlacesKey } from './google-places';

let session: { token: string; expires: number } | null = null;
let pending: Promise<string> | null = null;

async function tileSession(key: string): Promise<string> {
  if (session && session.expires > Date.now() + 3600000) return session.token;
  pending ??= (async () => {
    const response = await fetch(`https://tile.googleapis.com/v1/createSession?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'US' }),
    });
    const data = await response.json().catch(() => null) as { session?: unknown; expiry?: unknown } | null;
    if (!response.ok || typeof data?.session !== 'string') throw new Error(`Google map session failed (${response.status}).`);
    const expiry = Number(data.expiry);
    session = { token: data.session, expires: Number.isFinite(expiry) ? expiry * 1000 : Date.now() + 86400000 };
    return data.session;
  })().finally(() => { pending = null; });
  return pending;
}

/** Fetches one Google 2D roadmap tile server-side so the API key never reaches the browser. */
export async function googleMapTile(zoom: number, x: number, y: number): Promise<{ body: ArrayBuffer; type: string; cache: string }> {
  const key = googlePlacesKey();
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not configured.');
  const load = async (token: string): Promise<Response> => fetch(`https://tile.googleapis.com/v1/2dtiles/${zoom}/${x}/${y}?session=${encodeURIComponent(token)}&key=${encodeURIComponent(key)}`,
    { signal: AbortSignal.timeout(15000) });
  let response = await load(await tileSession(key));
  if (response.status === 401 || response.status === 403) { session = null; response = await load(await tileSession(key)); }
  if (!response.ok) throw new Error(`Google map tile failed (${response.status}).`);
  return { body: await response.arrayBuffer(), type: response.headers.get('content-type') ?? 'image/png',
    cache: `private, max-age=${Math.min(Number(/max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1]) || 3600, 86400)}` };
}
