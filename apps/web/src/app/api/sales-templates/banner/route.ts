import { NextRequest, NextResponse } from 'next/server';
import { isEmailDesignUrl } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { activeAgencyMember } from '../../../../lib/agency-membership';
import { WorkspaceError } from '../../../../lib/record-scope';
import { processSocialImage, readSocialUploadForm } from '../../../../lib/social-image';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError } from '../../../../lib/workspace-api';

export const runtime = 'nodejs';
const bucketName = 'email-branding-images';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const signature = request.nextUrl.pathname === '/api/account/signature-image';
  if ((!signature && session.teamAccess?.mode !== 'legacy') || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) {
    return NextResponse.json({ message: 'Upload the banner from Templates and Branding.' }, { status: 403 });
  }
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'Image storage is not connected.' }, { status: 503 });

  try {
    const member = await activeAgencyMember(db, session.user.id);
    if (!signature && member.role !== 'owner' && member.role !== 'admin') throw new WorkspaceError('Only owners and admins can upload template banners.', 403);
    const form = await readSocialUploadForm(request);
    const file = form.get('file');
    if ([...form.keys()].length !== 1 || !(file instanceof File)) throw new WorkspaceError('Choose one banner image.', 400);
    const { image } = await processSocialImage(Buffer.from(await file.arrayBuffer()));
    const bucket = db.storage.from(bucketName);
    const path = `${crypto.randomUUID()}.jpg`;
    const { data: { publicUrl } } = bucket.getPublicUrl(path);
    if (!isEmailDesignUrl(publicUrl)) throw new WorkspaceError('Banner storage needs a public HTTPS address.', 503);
    const { error } = await bucket.upload(path, image, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (error) {
      console.error('[sales-templates/banner]', error);
      throw new WorkspaceError('The banner could not be uploaded. Try again or contact your administrator.', 503);
    }
    return NextResponse.json({ image_url: publicUrl }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return workspaceApiError(error, 'sales-templates/banner');
  }
}
