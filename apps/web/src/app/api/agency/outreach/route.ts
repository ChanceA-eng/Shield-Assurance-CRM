import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { activeAgencyMember, agencyEnabled } from '../../../../lib/agency-membership';
import { workspaceApiError, workspaceBody, databaseError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';
import { isOutreachTemplate } from '@crm/shared';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    if (!agencyEnabled()) throw new WorkspaceError('Agent outreach is not enabled.', 503);
    await activeAgencyMember(db, session.user.id);
    const body = await workspaceBody(request);
    if (body.action === 'record_consent') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      const source = typeof body.source === 'string' ? body.source.trim() : '';
      if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) || !source || source.length > 1000 || typeof body.granted !== 'boolean') throw new WorkspaceError('Record a valid email, consent source and granted state.', 400);
      const saved = await db.rpc('record_marketing_consent', { p_actor: session.user.id, p_email: email, p_source: source, p_granted: body.granted });
      if (saved.error) throw databaseError(saved.error);
    } else {
      if (!isUuid(body.enrollment_id) || !isOutreachTemplate(body.template) || typeof body.enabled !== 'boolean') throw new WorkspaceError('Choose a sequence, template and explicit auto-send state.', 400);
      const saved = await db.rpc('authorize_agent_sequence', { p_actor: session.user.id, p_enrollment: body.enrollment_id, p_template: body.template, p_enabled: body.enabled });
      if (saved.error) throw databaseError(saved.error);
    }
    return NextResponse.json({ ok: true });
  } catch (error) { return workspaceApiError(error, 'agency/outreach'); }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    if (!agencyEnabled()) throw new WorkspaceError('Agent outreach is not enabled.', 503);
    const rows = await db.from('sequence_enrollments').select('id,lead_id,status,template,auto_send_enabled,leads(full_name,email)')
      .eq('agent_user_id', session.user.id).in('status', ['active', 'paused']).order('enrolled_at', { ascending: false }).limit(200);
    if (rows.error) throw databaseError(rows.error);
    return NextResponse.json({ enrollments: rows.data });
  } catch (error) { return workspaceApiError(error, 'agency/outreach/list'); }
}
