import { NextRequest, NextResponse } from 'next/server';
import { validateSocialReviewCommand } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceBody, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { socialDatabaseError } from '../../../../lib/social-marketing-errors';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const parsed = validateSocialReviewCommand(await workspaceBody(request));
    if (parsed.error !== null) throw new WorkspaceError(parsed.error, 400);
    const command = parsed.command;
    const { data, error } = await db.rpc('review_social_draft', {
      p_actor: session.user.id, p_id: command.id, p_action: command.action,
      p_expected_revision: command.expected_revision, p_expected_review_version: command.expected_review_version, p_reason: command.reason,
    });
    if (error) throw socialDatabaseError(error);
    if (!data) throw new WorkspaceError('The review was not confirmed. Reload before retrying.', 500);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'social-review/save'); }
}
