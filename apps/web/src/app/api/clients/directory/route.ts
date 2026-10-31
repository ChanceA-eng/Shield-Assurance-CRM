import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { requireApiSession } from '../../../../lib/api-auth';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { directoryFilters, directoryRows, type DirectoryAccount, type DirectoryPolicy, type DirectoryTask } from '../../../../lib/client-directory';
import { websiteBusinessDetails } from '../../../../lib/website-intake';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const page = Number(request.nextUrl.searchParams.get('page') ?? '0');
    const filter = request.nextUrl.searchParams.get('filter') ?? 'all';
    const selectedFilter = directoryFilters.find((value) => value === filter);
    const search = request.nextUrl.searchParams.get('q')?.trim() ?? '';
    if (!Number.isSafeInteger(page) || page < 0 || page > 100000 || !selectedFilter || search.length > 200) {
      throw new WorkspaceError('Choose a valid directory page, filter and search (up to 200 characters).', 400);
    }
    async function pages<T>(query: (offset: number) => PromiseLike<{ data: T[] | null; error: { message: string; code?: string } | null }>): Promise<T[]> {
      const rows: T[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await query(offset);
        if (result.error) throw databaseError(result.error);
        rows.push(...(result.data ?? []));
        if ((result.data ?? []).length < 500) return rows;
      }
    }
    const [accounts, policies, tasks, leads] = await Promise.all([
      pages<DirectoryAccount>((offset) => db.from('clients').select('id,full_name,email,phone,address,assigned_producer,account_type,source,email_consent,sms_consent,preferred_channel,created_at').order('id').range(offset, offset + 499)),
      pages<DirectoryPolicy>((offset) => db.from('policies').select('id,client_id,account_id,policy_number,status,effective_date,expiration_date,renewal_date').order('id').range(offset, offset + 499)),
      pages<DirectoryTask>((offset) => db.from('tasks').select('id,account_id,related_type,related_id,subject,due_date').eq('status', 'open').order('id').range(offset, offset + 499)),
      pages<{ id: string; account_id: string; form_payload: Record<string, unknown> | null }>((offset) =>
        db.from('leads').select('id,account_id,form_payload').not('account_id', 'is', null).order('id').range(offset, offset + 499)),
    ]);
    const businesses = new Map<string, string[]>();
    const leadAccounts = new Map(leads.map((lead) => [lead.id, lead.account_id]));
    for (const lead of leads) {
      const name = websiteBusinessDetails(lead.form_payload ?? {}).businessName;
      if (name) businesses.set(lead.account_id, [...new Set([...(businesses.get(lead.account_id) ?? []), name])]);
    }
    const ownedTasks = tasks.map((task) => ({ ...task,
      account_id: task.account_id ?? (task.related_type === 'lead' && task.related_id ? leadAccounts.get(task.related_id) ?? null : null) }));
    const rows = directoryRows(accounts, policies, ownedTasks, businesses, search, selectedFilter);
    return NextResponse.json({ items: rows.slice(page * 25, page * 25 + 25), total: rows.length, page, page_size: 25 });
  } catch (error) {
    return workspaceApiError(error, 'clients/directory');
  }
}
