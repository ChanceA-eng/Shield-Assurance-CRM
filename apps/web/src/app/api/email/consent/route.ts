import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { activeAgencyMember, agencyEnabled } from '../../../../lib/agency-membership';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    if (agencyEnabled() && (await activeAgencyMember(db, session.user.id)).role === 'agent') {
      throw new WorkspaceError('Only administrators can record agency marketing permission.', 403);
    }
    const body = await workspaceBody(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const source = typeof body.source === 'string' ? body.source.trim() : '';
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || email.length > 254 || source.length < 10 || source.length > 1000
      || typeof body.granted !== 'boolean') throw new WorkspaceError('Enter an email, whether permission was granted, and how and when the recipient gave permission.', 400);
    if (!body.granted) {
      const result = await db.rpc('unsubscribe_marketing_email', { p_email: email, p_reason: source });
      if (result.error) throw databaseError(result.error);
    } else {
      const blocked = await db.from('outreach_opt_outs').select('email').eq('email', email).maybeSingle();
      if (blocked.error) throw databaseError(blocked.error);
      if (blocked.data) throw new WorkspaceError('This address unsubscribed. Recording permission here cannot override that block.', 409);
      const result = await db.from('marketing_email_consents').upsert({
        email, purpose: 'outreach', source, consented_at: new Date().toISOString(),
        recorded_by_auth: session.user.id, revoked_at: null, revocation_source: null,
      }, { onConflict: 'email' });
      if (result.error) throw databaseError(result.error);
    }
    return NextResponse.json({ message: body.granted ? 'Marketing permission recorded.' : 'Promotional emails stopped.' });
  } catch (error) { return workspaceApiError(error, 'email/consent'); }
}
