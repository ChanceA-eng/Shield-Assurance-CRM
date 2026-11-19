import { NextRequest, NextResponse } from 'next/server';
import { activeAgencyMember } from '../../../lib/agency-membership';
import { getApiSession } from '../../../lib/api-auth';
import { isRecordType } from '@crm/shared';
import { isUuid } from '../../../lib/workspace-validation';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { leadContactRestrictions } from '../../../lib/message-delivery';

const MIGRATION = '20261113015000_record_contact_preferences';

function missingSchema(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205' || error?.code === 'PGRST204' || error?.code === 'PGRST202';
}

function contactPreferenceError(error: { message: string; code?: string }): WorkspaceError {
  if (!missingSchema(error)) return databaseError(error);
  console.error('[record-contact-preference/schema]', MIGRATION, error.code, error.message);
  return new WorkspaceError('Contact preferences are temporarily unavailable. Please try again.', 503);
}

async function accessRecord(db: NonNullable<ReturnType<typeof getSupabaseServerClient>>, actor: string, type: 'lead' | 'client', id: string) {
  const member = await activeAgencyMember(db, actor);
  const table = type === 'lead' ? 'leads' : 'clients';
  const record = await db.from(table).select(type === 'lead' ? 'id,agent_user_id,account_id' : 'id,agent_user_id')
    .eq('id', id).maybeSingle<{ id: string; agent_user_id: string | null; account_id?: string | null }>();
  if (record.error) throw databaseError(record.error);
  if (!record.data || (member.role === 'agent' && record.data.agent_user_id && record.data.agent_user_id !== actor)) {
    throw new WorkspaceError('Contact not found or unavailable.', 404);
  }
  return record.data;
}

async function preferenceState(
  db: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  type: 'lead' | 'client',
  id: string,
  linkedId?: string | null,
): Promise<{ do_not_contact: boolean; inherited: boolean; reason: string }> {
  const ownColumn = type === 'lead' ? 'lead_id' : 'client_id';
  const own = await db.from('record_contact_preferences').select('do_not_contact,reason')
    .eq(ownColumn, id).maybeSingle<{ do_not_contact: boolean; reason: string }>();
  if (own.error) throw contactPreferenceError(own.error);
  if (own.data?.do_not_contact) return { do_not_contact: true, inherited: false, reason: own.data.reason };

  if (type === 'lead') {
    const restrictions = await leadContactRestrictions(db, [id]);
    if (restrictions.get(id)) {
      return { do_not_contact: true, inherited: true, reason: 'A linked record is marked Do Not Contact.' };
    }
  }
  if (type === 'lead' && linkedId) {
    const linked = await db.from('record_contact_preferences').select('do_not_contact,reason').eq('client_id', linkedId)
      .maybeSingle<{ do_not_contact: boolean; reason: string }>();
    if (linked.error) throw contactPreferenceError(linked.error);
    if (linked.data?.do_not_contact) return { do_not_contact: true, inherited: true, reason: linked.data.reason };
  } else if (type === 'client') {
    const linkedLeads = await db.from('leads').select('id').eq('account_id', id);
    if (linkedLeads.error) throw databaseError(linkedLeads.error);
    if (linkedLeads.data?.length) {
      const linked = await db.from('record_contact_preferences').select('do_not_contact,reason')
        .in('lead_id', linkedLeads.data.map((lead) => lead.id)).eq('do_not_contact', true).limit(1).maybeSingle<{ do_not_contact: boolean; reason: string }>();
      if (linked.error) throw contactPreferenceError(linked.error);
      if (linked.data?.do_not_contact) return { do_not_contact: true, inherited: true, reason: linked.data.reason };
    }
  }
  return { do_not_contact: false, inherited: false, reason: '' };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) throw new WorkspaceError('Sign in before changing contact preferences.', 401);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const type = request.nextUrl.searchParams.get('type');
    const id = request.nextUrl.searchParams.get('id');
    if (!isRecordType(type) || !isUuid(id)) throw new WorkspaceError('Choose a valid lead or account.', 400);
    const record = await accessRecord(db, session.user.id, type, id);
    return NextResponse.json(await preferenceState(db, type, id, record.account_id),
      { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceApiError(error, 'record-contact-preference/read');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getApiSession(request);
    if (session.error) throw new WorkspaceError('Sign in before changing contact preferences.', 401);
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
    const body = await workspaceBody(request);
    if (!isRecordType(body.type) || !isUuid(body.id) || typeof body.do_not_contact !== 'boolean'
      || (body.reason !== undefined && (typeof body.reason !== 'string' || body.reason.length > 500))) {
      throw new WorkspaceError('Choose a valid contact preference.', 400);
    }
    const record = await accessRecord(db, session.user.id, body.type, body.id);
    const result = await db.rpc('set_record_contact_preference', {
      p_actor: session.user.id, p_type: body.type, p_id: body.id, p_do_not_contact: body.do_not_contact,
      p_reason: typeof body.reason === 'string' ? body.reason.trim() : '',
    });
    if (result.error) throw contactPreferenceError(result.error);
    return NextResponse.json(await preferenceState(db, body.type, body.id, record.account_id));
  } catch (error) {
    return workspaceApiError(error, 'record-contact-preference/save');
  }
}
