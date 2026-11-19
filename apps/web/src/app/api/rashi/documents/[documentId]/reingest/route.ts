import { NextResponse } from 'next/server';
import { reingestRashiDocument } from '../../../../../../lib/rashi-server';
import { workspaceApiError } from '../../../../../../lib/workspace-api';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<NextResponse> {
  try {
    const { documentId } = await context.params;
    const payload = await reingestRashiDocument(documentId);
    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return workspaceApiError(error, 'rashi/reingest');
  }
}
