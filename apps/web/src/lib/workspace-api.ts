import { NextRequest, NextResponse } from 'next/server';
import { isRecord } from './workspace-validation';
import { WorkspaceError } from './record-scope';

export async function workspaceBody(request: NextRequest): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new WorkspaceError('Send a valid JSON object.', 400);
    throw error;
  }
  if (!isRecord(value)) throw new WorkspaceError('Send a JSON object.', 400);
  return value;
}

export function assertSameOriginJson(request: NextRequest): void {
  const origin = request.headers.get('origin');
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (!origin || request.headers.get('sec-fetch-site') === 'cross-site' || !/^application\/json(?:\s*;|$)/.test(contentType)) {
    throw new WorkspaceError('Send campaign changes from this CRM using JSON.', 403);
  }
  const allowedOrigins = new Set([request.nextUrl.origin]);
  const configuredOrigin = process.env.CRM_WEB_ORIGIN?.trim();
  if (configuredOrigin) {
    try { allowedOrigins.add(new URL(configuredOrigin).origin); }
    catch { throw new WorkspaceError('Configure a valid CRM_WEB_ORIGIN before changing campaigns.', 503); }
  }
  if (!allowedOrigins.has(origin)) throw new WorkspaceError('Send campaign changes from this CRM using JSON.', 403);
}

export function workspaceApiError(error: unknown, label: string): NextResponse {
  if (error instanceof WorkspaceError) {
    if (error.status >= 500) console.error(`[${label}]`, error.message);
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error(`[${label}]`, error);
  return NextResponse.json({ message: 'Something went wrong saving this. Please try again.' }, { status: 500 });
}

const FRIENDLY_DATABASE_ERRORS: Record<string, string> = {
  '42501': 'You do not have permission to make this change.',
  '23505': 'A matching record already exists.',
  '40001': 'Someone else changed this at the same time. Refresh and try again.',
  '23503': 'A linked record no longer exists. Refresh the page and try again.',
  '22007': 'One of the dates is not valid.',
};

// Messages raised on purpose by our database functions are already written for staff, so keep them.
function isWrittenForStaff(message: string): boolean {
  return message.length > 0 && message.length <= 240 && !/\b(relation|column|constraint|violates|syntax|function|operator|null value|duplicate key|uuid|jsonb?|schema|PGRST|postgres)\b/i.test(message);
}

export function databaseError(error: { message: string; code?: string }): WorkspaceError {
  const code = error.code ?? '';
  const status = code === '42501' ? 403 : code === 'P0002' ? 404
    : ['23505', '40001', 'PT409'].includes(code) ? 409
      : ['23514', '23503', '22023', '22007', 'P0001'].includes(code) ? 400 : 500;
  if (status === 500) {
    console.error('[database]', code, error.message);
    return new WorkspaceError('Something went wrong. Please try again, and contact your administrator if it keeps happening.', 500);
  }
  if (isWrittenForStaff(error.message)) return new WorkspaceError(error.message, status);
  console.error('[database]', code, error.message);
  return new WorkspaceError(FRIENDLY_DATABASE_ERRORS[code] ?? (status === 404 ? 'This record could not be found. Refresh the page.' : 'This change could not be saved. Check the details and try again.'), status);
}

/** Staff-safe text for any failure: database errors are translated, technical details go to the server log only. */
export function friendlyErrorMessage(error: { message: string; code?: string } | null | undefined): string {
  if (!error) return 'Something went wrong. Please try again.';
  if (error.code) return databaseError(error).message;
  if (isWrittenForStaff(error.message)) return error.message;
  console.error('[error]', error.message);
  return 'Something went wrong. Please try again, and contact your administrator if it keeps happening.';
}
