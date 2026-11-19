import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerAuthClient } from './supabase-auth-server';
import { getSupabaseServerClient } from './supabase-server';
import type { User } from '@supabase/supabase-js';
import { activeAgencyMember, agencyEnabled } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { isTeamActivationRequest } from './route-authentication';
import { permitsTeamRequest, readTeamRequestAccess, type RequestAccess } from './team-request-access';

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() || null : null;
}

export async function getApiSession(request: NextRequest, options?: { teamActivation: true }): Promise<{ user: User; error: null; teamAccess?: RequestAccess } | { user: null; error: NextResponse }> {
  try {
    const token = bearerToken(request);
    const authClient = await createSupabaseServerAuthClient(token ?? undefined);

    if (!authClient) {
      return { user: null, error: NextResponse.json({ message: 'Authentication is not configured.' }, { status: 503 }) };
    }

    const { data, error } = token
      ? await authClient.auth.getUser(token)
      : await authClient.auth.getUser();

    if (error || !data.user) {
      return { user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) };
    }

    if (!(options?.teamActivation && isTeamActivationRequest(request.nextUrl.pathname, request.method, request.nextUrl.searchParams))
      && !(request.nextUrl.pathname === '/api/agency' && request.method === 'POST' && request.nextUrl.searchParams.get('bootstrap') === 'true'
      && data.user.id === process.env.CRM_BOOTSTRAP_OWNER_ID)) {
      if (agencyEnabled()) {
        const db = getSupabaseServerClient();
        if (!db) return { user: null, error: NextResponse.json({ message: 'Agency authorization is unavailable.' }, { status: 503 }) };
        await activeAgencyMember(db, data.user.id);
      } else {
        const membership = await authClient.rpc('agency_session_allowed');
        if (membership.error || typeof membership.data !== 'boolean') {
          console.error('[api-auth] Agency membership check unavailable', membership.error?.code);
          return { user: null, error: NextResponse.json({ message: 'Agency authorization is unavailable.' }, { status: 503 }) };
        }
        if (!membership.data) throw new WorkspaceError('An active agency invitation is required.', 403);
      }
      const teamAccess = await readTeamRequestAccess(authClient, data.user.id);
      if (!permitsTeamRequest(teamAccess, request.nextUrl.pathname, request.method)) {
        throw new WorkspaceError('You do not have access to this feature.', 403);
      }
      return { user: data.user, error: null, teamAccess };
    }
    return { user: data.user, error: null };
  } catch (error) {
    if (error instanceof WorkspaceError) return { user: null, error: NextResponse.json({ message: error.message }, { status: error.status }) };
    console.error('[api-auth] Session verification failed', error);
    return { user: null, error: NextResponse.json({ message: 'Authentication is not configured.' }, { status: 503 }) };
  }
}

export async function requireApiSession(request: NextRequest): Promise<NextResponse | null> {
  return (await getApiSession(request)).error;
}

export function apiActorName(user: User): string {
  const name: unknown = user.user_metadata?.full_name ?? user.user_metadata?.name;
  return typeof name === 'string' && name.trim() ? name.trim() : user.email ?? 'Authenticated agent';
}