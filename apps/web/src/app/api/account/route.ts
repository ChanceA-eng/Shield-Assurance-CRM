import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { accountMembership } from '../../../lib/agency-access';
import { WorkspaceError } from '../../../lib/record-scope';
import { workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import type { EmailChange } from '../../../lib/account-security';
import { signatureFormatting } from '../../../lib/email-formatting';
import { emailDocumentText, parseEmailDocument, parseEmailRows } from '@crm/shared';
import { databaseError } from '../../../lib/workspace-api';
import { hasTeamPermission } from '../../../lib/team-request-access';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const member = await accountMembership(db, session.user.id);
    const changes = await db.from('account_email_changes').select('id,user_id,old_email,new_email,status,expires_at,created_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(1).maybeSingle<EmailChange>();
    if (changes.error) throw new WorkspaceError('Your email change status could not load. Retry.', 503);
    return NextResponse.json({
      email: session.user.email ?? '',
      full_name: typeof session.user.user_metadata.full_name === 'string' ? session.user.user_metadata.full_name : '',
      contact_phone: typeof session.user.user_metadata.contact_phone === 'string' ? session.user.user_metadata.contact_phone : '',
      signature: typeof session.user.user_metadata.signature === 'string' ? session.user.user_metadata.signature : '',
      role: member?.active ? member.role : null,
      active: member?.active ?? false,
      email_verified: Boolean(session.user.email_confirmed_at),
      can_change_email: Boolean(member?.active && hasTeamPermission(session.teamAccess, 'team.manage')),
      email_change: changes.data,
      ...await signatureFormatting(db, session.user.id),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'account/read'); }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const body = await workspaceBody(request);
    if (Object.prototype.hasOwnProperty.call(body, 'signatureDocument')) {
      if (Object.keys(body).some((key) => !['signature', 'signatureDocument', 'signatureRows'].includes(key))) throw new WorkspaceError('Only signature fields can be saved here.', 400);
      let document, rows;
      try { document = parseEmailDocument(body.signatureDocument); rows = parseEmailRows(body.signatureRows); }
      catch (error) { throw new WorkspaceError(error instanceof Error ? error.message : 'Invalid signature design.', 400); }
      if (typeof body.signature !== 'string' || body.signature.trim() !== (document ? emailDocumentText(document).trim() : '')
        || body.signature.length > 2000 || JSON.stringify(document ?? {}).length > 12000 || JSON.stringify(rows ?? []).length > 18000) {
        throw new WorkspaceError('Keep your signature under 2000 characters and simplify its formatting or layout.', 400);
      }
      const saved = await db.rpc('save_email_signature', { p_actor: session.user.id, p_text: body.signature.trim(),
        p_document: document ?? null, p_rows: rows ?? null });
      if (saved.error) throw databaseError(saved.error);
      return NextResponse.json({ message: 'Your signature was saved.' });
    }
    if (Object.keys(body).length === 1 && typeof body.signature === 'string') {
      if (body.signature.length > 2000) throw new WorkspaceError('Keep your signature under 2000 characters.', 400);
      const saved = await db.rpc('save_email_signature', { p_actor: session.user.id, p_text: body.signature.trim(), p_document: null, p_rows: null });
      if (saved.error) {
        console.error('[account/signature]', saved.error.code);
        throw new WorkspaceError('Signature could not be saved. Retry.', 503);
      }
      return NextResponse.json({ message: 'Your signature was saved.' });
    }
    if (Object.keys(body).some((key) => key !== 'full_name' && key !== 'contact_phone')) {
      throw new WorkspaceError('Only your display name and contact phone can be changed here.', 400);
    }
    if (typeof body.full_name !== 'string' || !body.full_name.trim() || body.full_name.length > 120
      || typeof body.contact_phone !== 'string' || body.contact_phone.length > 40) {
      throw new WorkspaceError('Enter your display name (up to 120 characters) and a contact phone of up to 40 characters.', 400);
    }
    const result = await db.auth.admin.updateUserById(session.user.id, {
      user_metadata: { full_name: body.full_name.trim(), contact_phone: body.contact_phone.trim() },
    });
    if (result.error) {
      console.error('[account/update]', result.error.message);
      throw new WorkspaceError('Your account could not be saved. Please try again.', 503);
    }
    return NextResponse.json({ message: 'Your account was saved.' });
  } catch (error) { return workspaceApiError(error, 'account/update'); }
}
