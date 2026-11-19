import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from './supabase-server';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';

export const prospectHash = (value: string): string => createHash('sha256').update(value).digest('hex');
export const prospectToken = (): string => randomBytes(32).toString('base64url');
export function prospectDb(): SupabaseClient {
  if (process.env.CRM_PROSPECT_REQUESTS_ENABLED !== 'true') {
    throw new WorkspaceError('Questionnaires are not enabled. Complete the questionnaire migration and email setup before enabling CRM_PROSPECT_REQUESTS_ENABLED.', 503);
  }
  const db = getSupabaseServerClient();
  if (!db) throw new WorkspaceError('The CRM database is not connected.', 503);
  return db;
}
export async function prospectRpc(db: SupabaseClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await db.rpc(name, args);
  if (result.error) throw databaseError(result.error);
  const value: unknown = result.data;
  if (isRecord(value) && typeof value.error === 'string' && typeof value.status === 'number') {
    throw new WorkspaceError(value.error, value.status);
  }
  return value;
}
export function prospectJson(value: unknown): NextResponse {
  return NextResponse.json(value, { headers: {
    'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow',
  } });
}
export function requireProspectUploads(): void {
  if (process.env.CRM_PROSPECT_UPLOADS_ENABLED !== 'true') {
    throw new WorkspaceError('Document uploads are not enabled. Your agent must configure private malware scanning and approve document retention before requesting files.', 503);
  }
}
