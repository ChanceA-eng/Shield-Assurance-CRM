import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { securityLimit } from '../../../../lib/account-security';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { WorkspaceError } from '../../../../lib/record-scope';
import { assertSameOriginJson, databaseError, workspaceApiError, workspaceBody } from '../../../../lib/workspace-api';
import { isUuid } from '../../../../lib/workspace-validation';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    assertSameOriginJson(request);
    const body = await workspaceBody(request);
    if (!isUuid(body.member) || typeof body.challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.challenge)) {
      throw new WorkspaceError('This setup link is unavailable. Ask your administrator for a new invitation.', 403);
    }
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Account setup is unavailable.', 503);
    const result = await db.rpc('claim_team_setup', { p_target: body.member,
      p_digest: createHash('sha256').update(body.challenge).digest('hex') });
    if (result.error) throw databaseError(result.error);
    if (typeof result.data !== 'string' || !result.data) throw new WorkspaceError('Account setup is unavailable.', 503);
    await securityLimit(db, 'team-setup-claim', body.member, 8);
    const generated = await db.auth.admin.generateLink({ type: 'magiclink', email: result.data });
    if (generated.error || generated.data.user?.id !== body.member || !generated.data.properties?.hashed_token) {
      console.error('[team/setup] Could not create sign-in proof', generated.error?.code);
      throw new WorkspaceError('Account setup is temporarily unavailable. Retry the setup link.', 503);
    }
    return NextResponse.json({ token_hash: generated.data.properties.hashed_token }, {
      headers: { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' },
    });
  } catch (error) { return workspaceApiError(error, 'team/setup-claim'); }
}
