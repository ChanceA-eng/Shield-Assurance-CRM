import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const AUTH_REQUIRED = false;
const PUBLIC_PATHS = new Set(['/login']);
const PUBLIC_FILES = new Set(['/favicon.ico', '/robots.txt', '/sitemap.xml']);

function getSupabaseAuthEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return { url, anonKey };
}

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_FILES.has(pathname)) {
    return true;
  }

  return pathname.startsWith('/_next/static') || pathname.startsWith('/_next/image');
}

function isApiRoute(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.endsWith('/api') || pathname.includes('/api/');
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!AUTH_REQUIRED) {
    return NextResponse.next();
  }

  const pathname = request.nextUrl.pathname;
  const publicRoute = isPublicRoute(pathname);

  let response = NextResponse.next();

  const { url, anonKey } = getSupabaseAuthEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (publicRoute) {
    if (user && pathname === '/login') {
      return NextResponse.redirect(new URL('/', request.url));
    }

    return response;
  }

  if (!user) {
    if (isApiRoute(pathname)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const loginUrl = new URL('/login', request.url);
    const nextPath = `${request.nextUrl.pathname}${request.nextUrl.search}`;
    loginUrl.searchParams.set('next', nextPath);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};