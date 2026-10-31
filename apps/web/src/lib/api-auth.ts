import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerAuthClient } from './supabase-auth-server';
import { getSupabaseServerClient } from './supabase-server';
import type { User } from '@supabase/supabase-js';

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() || null : null;
}

export async function getApiSession(request: NextRequest): Promise<{ user: User; error: null } | { user: null; error: NextResponse }> {
  try {
    const token = bearerToken(request);
    const authClient = token ? getSupabaseServerClient() : await createSupabaseServerAuthClient();

    if (!authClient) {
      return { user: null, error: NextResponse.json({ message: 'Authentication is not configured.' }, { status: 503 }) };
    }

    const { data, error } = token
      ? await authClient.auth.getUser(token)
      : await authClient.auth.getUser();

    if (error || !data.user) {
      return { user: null, error: NextResponse.json({ message: 'Unauthorized.' }, { status: 401 }) };
    }

    return { user: data.user, error: null };
  } catch (error) {
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