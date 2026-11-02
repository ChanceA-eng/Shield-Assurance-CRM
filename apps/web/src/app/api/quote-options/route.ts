import { NextRequest, NextResponse } from 'next/server';
import { isDeepStrictEqual } from 'node:util';
import { isRecordType } from '@crm/shared';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { resolveRecordScope, WorkspaceError } from '../../../lib/record-scope';
import { isUuid } from '../../../lib/workspace-validation';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';
import { quoteFields, type QuoteOption } from '../../../lib/quote-options';

async function handle(request: NextRequest, method: 'GET' | 'POST' | 'PATCH'): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const type = request.nextUrl.searchParams.get('record_type'), id = request.nextUrl.searchParams.get('record_id');
    if (!isRecordType(type) || !isUuid(id)) throw new WorkspaceError('Select a valid lead or account.', 400);
    const scope = await resolveRecordScope(supabase, { type, id });
    const historyQuoteId = request.nextUrl.searchParams.get('history_quote_id');
    if (method === 'GET' && historyQuoteId !== null) {
      if (!isUuid(historyQuoteId)) throw new WorkspaceError('Select a valid quote history.', 400);
      const before = request.nextUrl.searchParams.get('before_id');
      if (before !== null && (!/^[1-9]\d{0,18}$/.test(before) || BigInt(before) > BigInt('9223372036854775807'))) {
        throw new WorkspaceError('Invalid quote history cursor.', 400);
      }
      if (!scope.clientId) throw new WorkspaceError('This quote is not available for this record.', 404);
      const quote = await supabase.from('quote_options').select('id').eq('id', historyQuoteId).eq('client_id', scope.clientId).maybeSingle();
      if (quote.error) throw databaseError(quote.error);
      if (!quote.data) throw new WorkspaceError('This quote is not available for this record.', 404);
      let history = supabase.from('quote_option_history').select('id::text,quote_id,changed_at,snapshot')
        .eq('quote_id', historyQuoteId).order('id', { ascending: false }).limit(100);
      if (before !== null) history = history.lt('id', before);
      const { data, error } = await history;
      if (error) throw databaseError(error);
      return NextResponse.json(data ?? []);
    }
    if (!scope.clientId) {
      if (method === 'GET') return NextResponse.json([]);
      throw new WorkspaceError('Link or create the correct account before saving quote options.', 409);
    }
    if (method === 'GET') {
      const page = Number(request.nextUrl.searchParams.get('page') ?? 0);
      if (!Number.isSafeInteger(page) || page < 0) throw new WorkspaceError('Invalid quote page.', 400);
      const { data, error } = await supabase.from('quote_options').select('*').eq('client_id', scope.clientId)
        .order('created_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
      if (error) throw databaseError(error);
      return NextResponse.json(data ?? []);
    }
    const body = await workspaceBody(request);
    if (!isUuid(body.id)) throw new WorkspaceError('A quote save ID is required.', 400);
    const fields = quoteFields(body);
    const actor = apiActorName(session.user);
    if (method === 'POST') {
      const result = await supabase.from('quote_options').insert({ ...fields, id: body.id, client_id: scope.clientId,
        lead_id: scope.leadId, source_lead_id: scope.leadId, created_by: actor, updated_by: actor }).select('*').single<QuoteOption>();
      if (result.error?.code === '23505') {
        const existing = await supabase.from('quote_options').select('*').eq('id', body.id).eq('client_id', scope.clientId).maybeSingle<QuoteOption>();
        if (existing.error) throw databaseError(existing.error);
        if (existing.data && isDeepStrictEqual(quoteFields({ ...existing.data }), fields)) return NextResponse.json(existing.data);
        throw new WorkspaceError('This save ID already belongs to a different quote. Refresh before saving.', 409);
      }
      if (result.error) throw databaseError(result.error);
      return NextResponse.json(result.data, { status: 201 });
    }
    if (typeof body.expected_updated_at !== 'string') throw new WorkspaceError('The last-loaded quote version is required.', 400);
    const { data, error } = await supabase.from('quote_options').update({ ...fields, updated_by: actor, updated_at: new Date().toISOString() })
      .eq('id', body.id).eq('client_id', scope.clientId).eq('updated_at', body.expected_updated_at).select('*').maybeSingle<QuoteOption>();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('This quote changed or is no longer available. Refresh before saving; your draft is retained.', 409);
    return NextResponse.json(data);
  } catch (error) { return workspaceApiError(error, `quote-options/${method.toLowerCase()}`); }
}
export const GET = (request: NextRequest): Promise<NextResponse> => handle(request, 'GET');
export const POST = (request: NextRequest): Promise<NextResponse> => handle(request, 'POST');
export const PATCH = (request: NextRequest): Promise<NextResponse> => handle(request, 'PATCH');
