import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession, getApiSession } from '../../../lib/api-auth';
import { parseImport } from '../../../lib/lead-import';
import { importMatches } from '../../../lib/import-intelligence';
import { workspaceApiError } from '../../../lib/workspace-api';

import { friendlyErrorMessage } from '../../../lib/workspace-api';
export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'The CRM database is not connected. Contact your administrator.' }, { status: 503 });
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ message: 'A file is required.' }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseImport(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown parse failure';
    return NextResponse.json({ message: `Could not parse file: ${message}` }, { status: 400 });
  }

  if (parsed.prospects.length === 0) {
    return NextResponse.json({ message: 'No prospects found in the file.' }, { status: 400 });
  }

  let duplicates: Map<number, string[]>;
  try { duplicates = await importMatches(supabase, parsed.prospects, session.user.id); }
  catch (failure) { return workspaceApiError(failure, 'import/matches'); }

  const batchInsert = await supabase
    .from('import_batches')
    .insert([
      {
        file_name: file.name,
        vendor_profile: parsed.vendorProfile,
        status: 'review',
        row_count: parsed.rowCount,
        prospect_count: parsed.prospects.length,
        duplicate_count: duplicates.size,
      },
    ])
    .select('id')
    .single<{ id: string }>();

  if (batchInsert.error || !batchInsert.data) {
    return NextResponse.json({ message: friendlyErrorMessage(batchInsert.error) ?? 'Batch could not be created. Please try again.' }, { status: 500 });
  }

  const batchId = batchInsert.data.id;
  const rows = parsed.prospects.map((prospect, index) => ({
    batch_id: batchId,
    full_name: prospect.full_name,
    email: prospect.email,
    phone: prospect.phone,
    address: prospect.address,
    line_of_business: prospect.line_of_business,
    disposition: duplicates.has(index) ? 'duplicate' : 'pending',
    duplicate_of: duplicates.get(index)?.[0] ?? null,
    payload: { profile: prospect.profile, raw: prospect.raw, duplicate_matches: duplicates.get(index) ?? [] },
  }));

  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase.from('import_prospects').insert(rows.slice(offset, offset + 200));
    if (error) {
      return NextResponse.json({ message: friendlyErrorMessage(error) }, { status: 500 });
    }
  }

  return NextResponse.json(
    {
      batch_id: batchId,
      vendor_profile: parsed.vendorProfile,
      row_count: parsed.rowCount,
      prospect_count: parsed.prospects.length,
      duplicate_count: duplicates.size,
    },
    { status: 201 },
  );
}
