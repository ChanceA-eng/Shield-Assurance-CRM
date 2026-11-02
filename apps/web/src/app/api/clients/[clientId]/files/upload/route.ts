import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../../lib/api-auth';
import { createDocumentUploadTicket, isUuid, validateUploadRequest } from '../../../../../../lib/account-documents';

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
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

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

  const { data: client, error: clientError } = await supabase.from('clients').select('id').eq('id', clientId).maybeSingle<{ id: string }>();
  if (clientError) return NextResponse.json({ message: clientError.message }, { status: 500 });
  if (!client) return NextResponse.json({ message: 'Account not found.' }, { status: 404 });

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
      },
      file: { file_name: validated.fileName, content_type: validated.contentType, file_size: validated.size },
    },
    { status: 201 },
  );
}
