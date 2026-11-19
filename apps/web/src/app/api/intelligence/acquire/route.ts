import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { approvedDiscoverySource, discoveryAccess } from '../../../../lib/discovery';
import { parseImport } from '../../../../lib/lead-import';
import { importMatches } from '../../../../lib/import-intelligence';
import { databaseError, workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isRecord, isUuid } from '../../../../lib/workspace-validation';

export const runtime = 'nodejs';
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  try {
    const db = getSupabaseServerClient();
    if (!db) throw new WorkspaceError('Database unavailable.', 503);
    await discoveryAccess(db, session.user.id);
    const form = await request.formData();
    const source = form.get('source_id'), requestId = form.get('request_id'), file = form.get('file');
    if (!isUuid(source) || !isUuid(requestId) || !(file instanceof File)) throw new WorkspaceError('Choose a source and file with a valid upload identity.', 400);
    if (file.size > 10 * 1024 * 1024) throw new WorkspaceError('Use a file no larger than 10 MB.', 400);
    await approvedDiscoverySource(db, source);
    const bytes = Buffer.from(await file.arrayBuffer());
    let parsed: ReturnType<typeof parseImport>;
    try { parsed = parseImport(bytes, file.name); } catch (error) {
      throw new WorkspaceError(`Could not parse file: ${error instanceof Error ? error.message : 'Check the file format.'}`, 400);
    }
    if (!parsed.prospects.length || parsed.prospects.length > 5000) throw new WorkspaceError('Use a file with between one and 5000 prospects.', 400);
    const matches = await importMatches(db, parsed.prospects, session.user.id);
    const saved = await db.rpc('acquire_discovery_file', {
      p_actor: session.user.id, p_source: source, p_request: requestId,
      p_fingerprint: createHash('sha256').update(JSON.stringify({ source, file: file.name })).update(bytes).digest('hex'),
      p_file: file.name, p_vendor: parsed.vendorProfile, p_row_count: parsed.rowCount,
      p_prospects: parsed.prospects.map((prospect, index) => ({
        full_name: prospect.full_name, email: prospect.email, phone: prospect.phone, address: prospect.address,
        line_of_business: prospect.line_of_business, disposition: matches.has(index) ? 'duplicate' : 'pending',
        duplicate_of: matches.get(index)?.[0] ?? null,
        payload: { profile: prospect.profile, raw: prospect.raw, duplicate_matches: matches.get(index) ?? [] },
      })),
    });
    if (saved.error) throw databaseError(saved.error);
    if (!isRecord(saved.data) || !isUuid(saved.data.batch_id) || typeof saved.data.already_acquired !== 'boolean'
      || typeof saved.data.prospect_count !== 'number' || !Number.isInteger(saved.data.prospect_count) || saved.data.prospect_count < 1) {
      throw new WorkspaceError('Acquisition status could not be verified. Retry the same upload before starting a new one.', 503);
    }
    return NextResponse.json(saved.data, { status: saved.data.already_acquired ? 200 : 201 });
  } catch (error) { return workspaceApiError(error, 'discovery/acquire'); }
}
