import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../../../../../lib/supabase-server';
import { getApiSession } from '../../../../../../../lib/api-auth';
import {
  CLIENT_FILE_COLUMNS,
  classifyClientFile,
  contentDisposition,
  downloadStoredObject,
  isUuid,
  storedLocation,
  type ClientFileRecord,
} from '../../../../../../../lib/account-documents';

interface RouteContext {
  params: Promise<{ clientId: string; fileId: string }>;
}

/** Streams a privately stored account document to an authenticated CRM user. */
export async function GET(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });

  const { clientId, fileId } = await context.params;
  if (!isUuid(clientId) || !isUuid(fileId)) return NextResponse.json({ message: 'A valid document id is required.' }, { status: 400 });

  const { data: record, error } = await supabase
    .from('client_files')
    .select(CLIENT_FILE_COLUMNS)
    .eq('id', fileId)
    .eq('client_id', clientId)
    .maybeSingle<ClientFileRecord>();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  if (!record) return NextResponse.json({ message: 'Document not found on this account.' }, { status: 404 });

  const location = storedLocation(record);
  if (!location) {
    const kind = classifyClientFile(record);
    return NextResponse.json(
      {
        message: kind === 'link'
          ? 'This document is an external link reference; open the link instead.'
          : 'This document was never uploaded. Upload the file again to store it.',
      },
      { status: 409 },
    );
  }

  const downloaded = await downloadStoredObject(supabase, location);
  if (!downloaded.ok) return NextResponse.json({ message: downloaded.message }, { status: downloaded.status });

  const mode = request.nextUrl.searchParams.get('disposition') === 'inline' ? 'inline' : 'attachment';
  const bytes = await downloaded.blob.arrayBuffer();
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': location.content_type || 'application/octet-stream',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': contentDisposition(record.file_name, mode),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
