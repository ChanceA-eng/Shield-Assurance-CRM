import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../lib/api-auth';
import { WorkspaceError } from '../../../lib/record-scope';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { staffPolicyRequestScope } from '../../../lib/team-request-access';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { isUuid } from '../../../lib/workspace-validation';

async function handle(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const submitting = request.method === 'POST';
  if (!(submitting ? staffPolicyRequestScope(session.teamAccess) : session.teamAccess?.policyAdmin === true)) {
    return NextResponse.json({ message: 'You do not have access to this policy request action.' }, { status: 403 });
  }
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const actor = { p_actor: session.user.id };
    if (request.method === 'GET') {
      const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
      if (!Number.isSafeInteger(page) || page < 0 || page > 10000) throw new WorkspaceError('Choose a valid inbox page.', 400);
      const { data, error } = await db.rpc('list_staff_policy_requests', {
        ...actor, p_page: page, p_closed: request.nextUrl.searchParams.get('closed') === 'true',
      });
      if (error) throw databaseError(error);
      if (!Array.isArray(data)) throw new Error('Invalid policy inbox response.');
      return NextResponse.json({ rows: data.slice(0, 25), more: data.length > 25 }, { headers });
    }
    const body = await workspaceBody(request);
    if (submitting) {
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (!isUuid(body.policy_id) || !description || description.length > 4000
        || (body.priority !== 1 && body.priority !== 2 && body.priority !== 3)) {
        throw new WorkspaceError('Choose a policy and urgency, and describe the change in up to 4,000 characters.', 400);
      }
      const { data, error } = await db.rpc('submit_staff_policy_request', {
        ...actor, p_policy: body.policy_id, p_priority: body.priority, p_description: description,
      });
      if (error) throw databaseError(error);
      if (!isUuid(data)) throw new Error('Invalid policy request receipt.');
      return NextResponse.json({ id: data }, { status: 201, headers });
    }
    if (!isUuid(body.id)) throw new WorkspaceError('Choose a current request.', 400);
    if (body.action === 'correct-policy') {
      const carrier = typeof body.carrier === 'string' ? body.carrier.trim() : '';
      const number = typeof body.policy_number === 'string' ? body.policy_number.trim() : '';
      if (!carrier || carrier.length > 200 || !number || number.length > 100) {
        throw new WorkspaceError('Enter a carrier and policy number.', 400);
      }
      const { error } = await db.rpc('correct_staff_request_policy', { ...actor, p_request: body.id, p_carrier: carrier, p_number: number });
      if (error) throw databaseError(error);
      return NextResponse.json({ saved: true }, { headers });
    }
    if (body.outcome !== 'handled' && body.outcome !== 'declined') {
      throw new WorkspaceError('Choose a request and review outcome.', 400);
    }
    const { error } = await db.rpc('resolve_staff_policy_request', { ...actor, p_request: body.id, p_outcome: body.outcome });
    if (error) throw databaseError(error);
    return NextResponse.json({ resolved: true }, { headers });
  } catch (error) {
    return workspaceApiError(error, 'staff-policy-requests');
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function POST(request: NextRequest): Promise<NextResponse> { return handle(request); }
export async function PATCH(request: NextRequest): Promise<NextResponse> { return handle(request); }
