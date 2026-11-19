import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { UPLOAD_TICKET_TTL_SECONDS } from './account-documents';
import { accountDocumentReadScope, accountRecordScope, type RequestAccess } from './team-request-access';
import { friendlyErrorMessage } from './workspace-api';

type UploadIdentity = {
  actor: string;
  path: string;
  fileName: string;
  contentType: string;
  size: number;
};

function sign(key: string, upload: UploadIdentity, expires: number): Buffer {
  return createHmac('sha256', key)
    .update(JSON.stringify(['account-upload-v1', upload.actor, upload.path, upload.fileName, upload.contentType, upload.size, expires]))
    .digest();
}

export function issueUploadConfirmation(key: string, upload: UploadIdentity, now = Date.now()): string {
  const expires = now + UPLOAD_TICKET_TTL_SECONDS * 1000;
  return `${expires}.${sign(key, upload, expires).toString('hex')}`;
}

export function verifyUploadConfirmation(key: string, value: unknown, upload: UploadIdentity, now = Date.now()): boolean {
  if (typeof value !== 'string' || !/^\d{13}\.[0-9a-f]{64}$/.test(value)) return false;
  const [expires, signature] = value.split('.');
  return Number(expires) > now && timingSafeEqual(Buffer.from(signature, 'hex'), sign(key, upload, Number(expires)));
}

export async function checkAccountUploadAccess(
  db: SupabaseClient, access: RequestAccess | undefined, actor: string, clientId: string,
): Promise<NextResponse | null> {
  const write = accountRecordScope(access, 'documents.edit');
  const read = accountDocumentReadScope(access);
  if (!write || !read) return NextResponse.json({ message: 'You do not have access to upload account documents.' }, { status: 403 });
  const query = db.from('clients').select('id').eq('id', clientId);
  if (write === 'assigned' || read === 'assigned') query.eq('agent_user_id', actor);
  const { data, error } = await query.maybeSingle<{ id: string }>();
  if (error) return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  return data ? null : NextResponse.json({ message: 'Account not found.' }, { status: 404 });
}
