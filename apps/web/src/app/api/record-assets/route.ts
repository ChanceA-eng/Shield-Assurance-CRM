import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { isRecordType, type RecordTarget, type WorkspaceAsset } from '@crm/shared';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { apiActorName, getApiSession } from '../../../lib/api-auth';
import { isUuid, validateAsset, isRecord } from '../../../lib/workspace-validation';
import { recordFilter, resolveRecordScope, WorkspaceError } from '../../../lib/record-scope';
import { databaseError, workspaceApiError, workspaceBody } from '../../../lib/workspace-api';

const columns = 'id,client_id,lead_id,title,asset_type,value,metadata,archived_at,created_at,updated_at,created_by,updated_by';

function targetOf(request: NextRequest): RecordTarget {
  const type = request.nextUrl.searchParams.get('record_type');
  const id = request.nextUrl.searchParams.get('record_id');
  if (!isRecordType(type) || !isUuid(id)) throw new WorkspaceError('A valid lead or client is required.', 400);
  return { type, id };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const scope = await resolveRecordScope(supabase, targetOf(request));
    const page = Number(request.nextUrl.searchParams.get('page') ?? '0');
    if (!Number.isSafeInteger(page) || page < 0) throw new WorkspaceError('Invalid asset page.', 400);
    let query = supabase.from('client_assets').select(columns).or(recordFilter(scope)).neq('asset_type', 'note');
    query = request.nextUrl.searchParams.get('archived') === 'true' ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
    const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(page * 100, page * 100 + 99);
    if (error) throw databaseError(error);
    return NextResponse.json(data ?? []);
  } catch (error) {
    return workspaceApiError(error, 'record-assets/get');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const scope = await resolveRecordScope(supabase, targetOf(request));
    const body = await workspaceBody(request);
    const asset = validateAsset(body);
    if (typeof asset === 'string') throw new WorkspaceError(asset, 400);
    if (body.id !== undefined && !isUuid(body.id)) throw new WorkspaceError('Invalid asset save id.', 400);
    const id = typeof body.id === 'string' ? body.id : randomUUID();
    const metadata = { version: 1, details: asset.details, source: asset.source, source_reference: asset.source_reference, reported_at: new Date().toISOString() };
    const { data, error } = await supabase.from('client_assets').insert({
      id, lead_id: scope.leadId, client_id: scope.clientId, title: asset.title,
      asset_type: asset.asset_type, metadata, created_by: apiActorName(session.user),
    }).select(columns).single<WorkspaceAsset>();
    if (error?.code === '23505') {
      const existing = await supabase.from('client_assets').select(columns).eq('id', id).or(recordFilter(scope)).maybeSingle<WorkspaceAsset>();
      if (existing.error) throw databaseError(existing.error);
      if (existing.data?.title === asset.title && existing.data.asset_type === asset.asset_type
        && existing.data.metadata.source === asset.source
        && isDeepStrictEqual(existing.data.metadata.details, asset.details) && (existing.data.metadata.source_reference ?? null) === asset.source_reference) {
        return NextResponse.json(existing.data);
      }
      throw new WorkspaceError('This save id is already used by another asset. Refresh before saving again.', 409);
    }
    if (error) throw databaseError(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return workspaceApiError(error, 'record-assets/post');
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  try {
    const scope = await resolveRecordScope(supabase, targetOf(request));
    const body = await workspaceBody(request);
    if (!isUuid(body.id) || typeof body.expected_updated_at !== 'string') throw new WorkspaceError('An asset id and last-loaded timestamp are required.', 400);
    const existing = await supabase.from('client_assets').select(columns).eq('id', body.id).or(recordFilter(scope)).maybeSingle<WorkspaceAsset>();
    if (existing.error) throw databaseError(existing.error);
    if (!existing.data) throw new WorkspaceError('Asset not found in this profile.', 404);
    const updates: Record<string, unknown> = { updated_by: apiActorName(session.user) };
    if (body.action === 'archive' || body.action === 'restore') {
      updates.archived_at = body.action === 'archive' ? new Date().toISOString() : null;
    } else {
      const asset = validateAsset(body);
      if (typeof asset === 'string') throw new WorkspaceError(asset, 400);
      updates.title = asset.title;
      updates.asset_type = asset.asset_type;
      updates.metadata = {
        ...(isRecord(existing.data.metadata) ? existing.data.metadata : {}),
        version: 1, details: asset.details, source: asset.source, source_reference: asset.source_reference, reported_at: new Date().toISOString(),
      };
    }
    const { data, error } = await supabase.from('client_assets').update(updates)
      .eq('id', body.id).eq('updated_at', body.expected_updated_at).or(recordFilter(scope)).select(columns).maybeSingle<WorkspaceAsset>();
    if (error) throw databaseError(error);
    if (!data) throw new WorkspaceError('Someone changed this asset. Refresh and review their changes before saving.', 409);
    return NextResponse.json(data);
  } catch (error) {
    return workspaceApiError(error, 'record-assets/patch');
  }
}
