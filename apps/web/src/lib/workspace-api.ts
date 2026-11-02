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

export function workspaceApiError(error: unknown, label: string): NextResponse {
  if (error instanceof WorkspaceError) {
    if (error.status >= 500) console.error(`[${label}]`, error.message);
    return NextResponse.json({ message: error.message }, { status: error.status });
  }
  console.error(`[${label}]`, error);
  return NextResponse.json({ message: 'The record could not be saved. Please try again.' }, { status: 500 });
}

export function databaseError(error: { message: string; code?: string }): WorkspaceError {
  const status = error.code === 'P0002' ? 404
    : ['23505', '40001'].includes(error.code ?? '') ? 409
      : ['23514', '23503', '22023', '22007'].includes(error.code ?? '') ? 400 : 500;
  return new WorkspaceError(error.message, status);
}
