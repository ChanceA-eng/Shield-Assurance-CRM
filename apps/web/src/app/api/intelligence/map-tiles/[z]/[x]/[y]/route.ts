import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../../../../lib/api-auth';
import { googleMapTile } from '../../../../../../../lib/google-map-tiles';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: Promise<{ z: string; x: string; y: string }> }): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const { z, x, y } = await params;
  const [zoom, column, row] = [z, x, y].map(Number);
  if (![zoom, column, row].every(Number.isInteger) || zoom < 0 || zoom > 22 || column < 0 || row < 0 || column >= 2 ** zoom || row >= 2 ** zoom) {
    return NextResponse.json({ message: 'Map tile is out of range.' }, { status: 400 });
  }
  try {
    const tile = await googleMapTile(zoom, column, row);
    return new NextResponse(tile.body, { status: 200, headers: { 'Content-Type': tile.type, 'Cache-Control': tile.cache } });
  } catch (error) {
    console.error('[map-tiles]', error instanceof Error ? error.message : error);
    return NextResponse.json({ message: 'Google map tiles are unavailable.' }, { status: 502 });
  }
}
