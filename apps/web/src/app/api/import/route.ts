import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServerClient } from '../../../lib/supabase-server';
import { requireApiSession } from '../../../lib/api-auth';
import { parseImport, type StagedProspect } from '../../../lib/lead-import';

export const runtime = 'nodejs';

interface ExistingRecord {
  id: string;
  email: string | null;
  phone: string | null;
}

function phoneDigits(value: string | null): string {
  return (value ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
}

async function findDuplicates(prospects: StagedProspect[]): Promise<Map<number, string>> {
  const supabase = getSupabaseServerClient();
  const duplicates = new Map<number, string>();
  if (!supabase) return duplicates;

  const [leadRows, clientRows] = await Promise.all([
    supabase.from('leads').select('id,email,phone').limit(2000),
    supabase.from('clients').select('id,email,phone').limit(2000),
  ]);

  const leadByEmail = new Map<string, string>();
  const leadByPhone = new Map<string, string>();
  for (const row of (leadRows.data ?? []) as ExistingRecord[]) {
    if (row.email) leadByEmail.set(row.email.toLowerCase(), row.id);
    const digits = phoneDigits(row.phone);
    if (digits) leadByPhone.set(digits, row.id);
  }
  const clientByEmail = new Map<string, string>();
  const clientByPhone = new Map<string, string>();
  for (const row of (clientRows.data ?? []) as ExistingRecord[]) {
    if (row.email) clientByEmail.set(row.email.toLowerCase(), row.id);
    const digits = phoneDigits(row.phone);
    if (digits) clientByPhone.set(digits, row.id);
  }

  prospects.forEach((prospect, index) => {
    const email = prospect.email?.toLowerCase() ?? '';
    const digits = phoneDigits(prospect.phone);
    if (email && leadByEmail.has(email)) duplicates.set(index, `lead:${leadByEmail.get(email)}`);
    else if (digits && leadByPhone.has(digits)) duplicates.set(index, `lead:${leadByPhone.get(digits)}`);
    else if (email && clientByEmail.has(email)) duplicates.set(index, `client:${clientByEmail.get(email)}`);
    else if (digits && clientByPhone.has(digits)) duplicates.set(index, `client:${clientByPhone.get(digits)}`);
  });

  return duplicates;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
  }

  const { data, error } = await supabase
    .from('import_batches')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    return NextResponse.json({ message: error.message }, { status: 500 });
  }

  return NextResponse.json(data ?? [], { status: 200 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = await requireApiSession(request);
  if (authError) return authError;

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ message: 'Supabase is not configured.' }, { status: 503 });
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

  const duplicates = await findDuplicates(parsed.prospects);

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
    return NextResponse.json({ message: batchInsert.error?.message ?? 'Failed to create batch.' }, { status: 500 });
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
    duplicate_of: duplicates.get(index) ?? null,
    payload: { profile: prospect.profile, raw: prospect.raw },
  }));

  for (let offset = 0; offset < rows.length; offset += 200) {
    const { error } = await supabase.from('import_prospects').insert(rows.slice(offset, offset + 200));
    if (error) {
      return NextResponse.json({ message: error.message }, { status: 500 });
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
