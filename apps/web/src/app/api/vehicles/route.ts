import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../lib/api-auth';
import { vehicleLookup } from '../../../lib/vehicle-catalog';
import { workspaceApiError } from '../../../lib/workspace-api';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireApiSession(request);
  if (auth) return auth;
  try { return NextResponse.json(await vehicleLookup(request.nextUrl.searchParams), { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return workspaceApiError(error, 'vehicles/lookup'); }
}
