import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { databaseError, workspaceApiError } from '../../../lib/workspace-api';
import { isRecord } from '../../../lib/workspace-validation';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  try {
    const result = await db.rpc('crm_shell_summary');
    if (result.error) throw databaseError(result.error);
    const data: unknown = result.data;
    if (!isRecord(data) || !Number.isSafeInteger(data.overdueCount) || !Number.isSafeInteger(data.dueTodayCount)
      || !Number.isSafeInteger(data.unreadCount) || !Array.isArray(data.notifications)
      || !isRecord(data.unreadMessages) || !Number.isSafeInteger(data.unreadMessages.total)
      || !isRecord(data.unreadMessages.byClient) || !isRecord(data.unreadMessages.byLead)) {
      throw new Error('The notification summary returned an invalid response.');
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'shell/get'); }
}
