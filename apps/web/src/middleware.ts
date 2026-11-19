import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { authenticatesInReadHandler, isTeamActivationRequest } from './lib/route-authentication';
import { permitsTeamRequest, readTeamRequestAccess, teamLanding } from './lib/team-request-access';
import { POLICY_ADMIN_HEADER, STAFF_WORKSPACE_HEADER, staffWorkspace } from './lib/staff-workspace';
import { STAFF_RECORDS_HEADER, visibleStaffRecords } from './lib/staff-records';

const AUTH_REQUIRED = true;
const PUBLIC_PATHS = new Set(['/login', '/auth/accept', '/auth/confirm', '/auth/recovery']);
const PUBLIC_FILES = new Set(['/favicon.ico', '/robots.txt', '/sitemap.xml']);

/**
 * API endpoints called by external systems (Vercel cron, inbound email webhooks,
 * website lead forms). They cannot carry a Supabase session cookie; each route
 * enforces its own authorization (CRON_SECRET bearer, payload validation, etc.).
 */
const PUBLIC_API_PREFIXES = [
  '/api/cron/',
  '/api/messages/process-scheduled',
  '/api/messages/webhook',
  '/api/messages/sms-webhook',
];
const PUBLIC_GMAIL_PATHS = new Set(['/api/gmail/push', '/api/gmail/sync/worker']);

/** Documented public website lead-form endpoints (POST/OPTIONS only; GET stays protected). */
const PUBLIC_LEAD_POST_PATHS = new Set(['/api/leads', '/api/leads/create']);

function isPublicApiRoute(pathname: string, method: string): boolean {
  if (/^\/api\/questionnaire\/[A-Za-z0-9_-]{43}$/.test(pathname)) return method === 'GET' || method === 'POST';
  if (/^\/api\/intelligence\/questionnaire\/[A-Za-z0-9_-]{43}$/.test(pathname)) return method === 'GET' || method === 'POST';
  if (pathname === '/api/google-calendar/callback' || pathname === '/api/zoom/callback') return method === 'GET';
  if (/^\/api\/appointments\/manage\/[A-Za-z0-9_-]{43}$/.test(pathname)) return method === 'GET' || method === 'POST';
  if (pathname === '/api/instantly/webhook') return method === 'POST';
  if (pathname === '/api/auth/recovery' || pathname === '/api/auth/confirm') return method === 'POST';
  if (pathname === '/api/email/resend') return method === 'POST';
  if (pathname === '/api/email/unsubscribe') return method === 'GET' || method === 'POST';
  if (PUBLIC_GMAIL_PATHS.has(pathname)) return method === 'POST';
  if (PUBLIC_API_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return true;
  }

  return (method === 'POST' || method === 'OPTIONS') && PUBLIC_LEAD_POST_PATHS.has(pathname);
}

function getSupabaseAuthEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }

  return { url, anonKey };
}

function isPublicRoute(pathname: string): boolean {
  if (/^\/secure-intake\/[A-Za-z0-9_-]{43}$/.test(pathname)) return true;
  if (/^\/intelligence\/questionnaire\/[A-Za-z0-9_-]{43}$/.test(pathname)) return true;
  if (/^\/appointments\/manage\/[A-Za-z0-9_-]{43}$/.test(pathname)) return true;
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
  if (request.method !== 'GET' && request.method !== 'HEAD'
    && (pathname.startsWith('/api/account') || pathname === '/api/agency' || pathname.startsWith('/api/auth/') || pathname === '/api/settings/account-email'
      || pathname === '/api/zoom' || pathname === '/api/zoom/connect')) {
    const origin = request.headers.get('origin');
    const host = request.headers.get('host');
    const hostOrigin = host ? `${request.nextUrl.protocol}//${host}` : null;
    if (request.headers.get('sec-fetch-site') === 'cross-site'
      || (origin && origin !== request.nextUrl.origin && origin !== hostOrigin && origin !== process.env.CRM_WEB_ORIGIN)
      || !request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
      return NextResponse.json({ message: 'Send account changes from this CRM using JSON.' }, { status: 403 });
    }
  }

  if (isPublicApiRoute(pathname, request.method)) {
    return NextResponse.next();
  }
  if (authenticatesInReadHandler(pathname, request.method)) return NextResponse.next();

  const publicRoute = isPublicRoute(pathname);

  const forwarded = new Headers(request.headers);
  forwarded.delete(STAFF_WORKSPACE_HEADER);
  forwarded.delete(STAFF_RECORDS_HEADER);
  forwarded.delete(POLICY_ADMIN_HEADER);
  let response = NextResponse.next({ request: { headers: forwarded } });

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
    if (pathname.startsWith('/auth/') || pathname.startsWith('/appointments/manage/') || pathname.startsWith('/secure-intake/')) {
      response.headers.set('Referrer-Policy', 'no-referrer');
      response.headers.set('Cache-Control', 'no-store');
      if (pathname.startsWith('/secure-intake/')) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
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

  if (!isTeamActivationRequest(pathname, request.method, request.nextUrl.searchParams)
    && !(pathname === '/api/agency' && request.method === 'POST' && request.nextUrl.searchParams.get('bootstrap') === 'true'
    && user.id === process.env.CRM_BOOTSTRAP_OWNER_ID)) {
    const strict = process.env.CRM_MULTI_AGENT_ENABLED === 'true';
    const membership = strict
      ? await supabase.from('agency_members').select('active').eq('user_id', user.id).eq('active', true).maybeSingle()
      : await supabase.rpc('agency_session_allowed');
    const unavailable = membership.error || (!strict && typeof membership.data !== 'boolean');
    if (unavailable || !membership.data) {
      return NextResponse.json({ message: unavailable ? 'Agency authorization is unavailable.' : 'An active agency invitation is required.' }, { status: unavailable ? 503 : 403 });
    }
    try {
      const access = await readTeamRequestAccess(supabase, user.id);
      if (pathname === '/' && access.mode === 'restricted') {
        const redirect = NextResponse.redirect(new URL(teamLanding(access), request.url));
        response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
        return redirect;
      }
      if (!permitsTeamRequest(access, pathname, request.method)) {
        return NextResponse.json({ message: 'You do not have access to this feature.' }, { status: 403 });
      }
      if (!isApiRoute(pathname)) {
        forwarded.set(STAFF_WORKSPACE_HEADER, staffWorkspace(access));
        if (access.policyAdmin) forwarded.set(POLICY_ADMIN_HEADER, 'true');
        if (access.mode === 'restricted') forwarded.set(STAFF_RECORDS_HEADER, visibleStaffRecords(access).join(','));
        const page = NextResponse.next({ request: { headers: forwarded } });
        response.cookies.getAll().forEach((cookie) => page.cookies.set(cookie));
        response = page;
      }
    } catch (error) {
      console.error('[middleware] Team authorization check failed', error);
      return NextResponse.json({ message: 'Team authorization is unavailable.' }, { status: 503 });
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
};