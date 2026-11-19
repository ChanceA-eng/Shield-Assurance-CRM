import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../../lib/api-auth';
import { createDocumentUploadTicket, isUuid, validateUploadRequest } from '../../../../../../lib/account-documents';

import { checkAccountUploadAccess, issueUploadConfirmation } from '../../../../../../lib/account-upload-access';
interface RouteContext {
  params: Promise<{ clientId: string }>;
}

/**
 * Issues a single-use signed upload URL into the private account document bucket.
 * The browser uploads bytes directly to storage, then calls /upload/complete.
 */
export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });

  const { clientId } = await context.params;
  if (!isUuid(clientId)) return NextResponse.json({ message: 'A valid account id is required.' }, { status: 400 });

  let payload: { file_name?: unknown; content_type?: unknown; file_size?: unknown };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }

  const validated = validateUploadRequest({ fileName: payload.file_name, contentType: payload.content_type, size: payload.file_size });
  if (!validated.ok) return NextResponse.json({ message: validated.message }, { status: validated.status });

  const accessDenied = await checkAccountUploadAccess(supabase, session.teamAccess, session.user.id, clientId);
  if (accessDenied) return accessDenied;
  const confirmationKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!confirmationKey && session.teamAccess?.mode === 'restricted') {
    return NextResponse.json({ message: 'Document confirmation is unavailable.' }, { status: 503 });
  }

  const ticket = await createDocumentUploadTicket(supabase, { clientId, fileName: validated.fileName, contentType: validated.contentType });
  if (!ticket.ok) return NextResponse.json({ message: ticket.message }, { status: ticket.status });

  return NextResponse.json(
    {
      upload: {
        storage_path: ticket.ticket.path,
        signed_url: ticket.ticket.signedUrl,
        token: ticket.ticket.token,
        content_type: ticket.ticket.contentType,
        expires_in_seconds: ticket.ticket.expiresInSeconds,
        ...(confirmationKey ? { confirmation: issueUploadConfirmation(confirmationKey, { ...validated, actor: session.user.id, path: ticket.ticket.path }) } : {}),
      },
      file: { file_name: validated.fileName, content_type: validated.contentType, file_size: validated.size },
    },
    { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
  );
}
