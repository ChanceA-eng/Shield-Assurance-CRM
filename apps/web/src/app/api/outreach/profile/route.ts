import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { getMarketingProfile, saveMarketingProfile } from '../../../../lib/marketing-profile';
import { workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

async function handle(request: NextRequest, write: boolean): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const type = request.nextUrl.searchParams.get('record_type');
    const id = request.nextUrl.searchParams.get('record_id') ?? '';
    if (type !== 'lead' && type !== 'client') throw new WorkspaceError('Choose a lead or client.', 400);
    const profile = write
      ? await saveMarketingProfile(supabase, { type, id }, (await workspaceBody(request)).profile)
      : await getMarketingProfile(supabase, { type, id });
    return NextResponse.json({ profile });
  } catch (error) {
    return workspaceApiError(error, 'outreach/profile');
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request, false); }
export async function PUT(request: NextRequest): Promise<NextResponse> { return handle(request, true); }
