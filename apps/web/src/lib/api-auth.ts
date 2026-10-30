import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerAuthClient } from './supabase-auth-server';
import { getSupabaseServerClient } from './supabase-server';

function bearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization') ?? '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() || null : null;
}

export async function requireApiSession(request: NextRequest): Promise<NextResponse | null> {
  try {
    const token = bearerToken(request);
    const authClient = token ? getSupabaseServerClient() : await createSupabaseServerAuthClient();

    if (!authClient) {
      return NextResponse.json({ message: 'Authentication is not configured.' }, { status: 503 });
    }

    const { data, error } = token
      ? await authClient.auth.getUser(token)
      : await authClient.auth.getUser();

    if (error || !data.user) {
      return NextResponse.json({ message: 'Unauthorized.' }, { status: 401 });
    }

    return null;
  } catch {
    return NextResponse.json({ message: 'Authentication is not configured.' }, { status: 503 });
  }
}