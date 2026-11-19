import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { isStaffRecordKind, staffRecordScope } from '../../../lib/staff-records';
import { accountRecordScope, staffPolicyRequestScope } from '../../../lib/team-request-access';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';
import { isRecord } from '../../../lib/workspace-validation';

const pageSize = 25;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const params = request.nextUrl.searchParams;
  const kind = params.get('kind');
  const page = Number(params.get('page') ?? 0);
  const search = (params.get('q') ?? '').trim();
  if (!isStaffRecordKind(kind) || !Number.isSafeInteger(page) || page < 0 || page > 10000 || search.length > 100) {
    return NextResponse.json({ message: 'Choose a valid record list and search.' }, { status: 400 });
  }
  const scope = staffRecordScope(session.teamAccess, kind);
  if (!scope) return NextResponse.json({ message: 'You do not have access to these records.' }, { status: 403 });
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });

  const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
  const start = page * pageSize;
  try {
    const policy = kind === 'policies';
    const accountEdit = kind === 'accounts' ? accountRecordScope(session.teamAccess, 'accounts.edit') : null;
    const query = db.from(kind === 'accounts' ? 'clients' : kind).select(policy
      ? 'id,policy_number,carrier,line_of_business,status,effective_date,renewal_date,account:clients!policies_client_id_fkey!inner(full_name,agent_user_id)'
      : kind === 'leads' ? 'id,full_name,email,phone,status,line_of_business' : 'id,full_name,email,phone,account_type,agent_user_id');
    if (kind === 'leads') query.is('archived_at', null);
    if (scope === 'assigned') query.eq(policy ? 'account.agent_user_id' : 'agent_user_id', session.user.id);
    if (search) query.ilike(policy ? 'account.full_name' : 'full_name', pattern);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(start, start + pageSize);
    if (error) throw databaseError(error);
    const rows = data.slice(0, pageSize).map((row: unknown) => {
      if (!isRecord(row)) throw new Error('Invalid staff record response.');
      if (kind === 'policies') {
        const requestScope = staffPolicyRequestScope(session.teamAccess);
        const account = isRecord(row.account) ? row.account : null;
        return { ...row, account: account ? { full_name: account.full_name } : null,
          canRequest: requestScope === 'agency' || (requestScope === 'assigned' && account?.agent_user_id === session.user.id) };
      }
      if (kind !== 'accounts') return row;
      const { agent_user_id, ...account } = row;
      return { ...account, canEdit: accountEdit === 'agency' || (accountEdit === 'assigned' && agent_user_id === session.user.id) };
    });
    return NextResponse.json({ rows, more: data.length > pageSize }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceApiError(error, 'staff-records/get');
  }
}
