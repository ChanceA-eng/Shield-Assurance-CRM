import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { readUnsubscribeToken } from '../../../../lib/marketing-email';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { addInstantlyBlocklistEntry, InstantlyApiError } from '../../../../lib/instantly';

const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    readUnsubscribeToken(request.nextUrl.searchParams.get('token') ?? '');
    // GET is deliberately non-mutating so link scanners cannot unsubscribe a recipient.
    return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Unsubscribe</title><body><h1>Stop promotional emails</h1><p>Confirm below to stop promotional emails from Shield Assurance.</p><form method="post"><button type="submit">Unsubscribe</button></form></body></html>', {
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" },
    });
  } catch (error) { return workspaceApiError(error, 'email/unsubscribe'); }
}

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const email = readUnsubscribeToken(request.nextUrl.searchParams.get('token') ?? '');
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Unsubscribe is temporarily unavailable. Please try again.', 503);
    const result = await db.rpc('unsubscribe_marketing_email', { p_email: email });
    if (result.error) throw databaseError(result.error);
    const campaignLead = await db.from('instantly_campaign_leads').select('email').eq('email', email).limit(1);
    if (campaignLead.error) throw databaseError(campaignLead.error);
    if (campaignLead.data?.length) {
      try {
        await addInstantlyBlocklistEntry(email);
      } catch (error) {
        console.error('[email/unsubscribe/instantly-blocklist]', error);
        const detail = error instanceof InstantlyApiError
          ? error.message
          : 'Instantly suppression could not be confirmed.';
        return new NextResponse(`Unsubscribed in the CRM, but provider suppression was not confirmed. Please retry or contact the agency: ${detail}`, {
          status: 503,
          headers,
        });
      }
    }
    return new NextResponse('You have been unsubscribed from promotional emails from Shield Assurance.', { headers });
  } catch (error) { return workspaceApiError(error, 'email/unsubscribe'); }
}
