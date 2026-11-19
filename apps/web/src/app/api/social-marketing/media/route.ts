import { NextRequest, NextResponse } from 'next/server';
import { SOCIAL_MEDIA_BUCKET, socialMediaMetadataError, type SocialMediaAsset } from '@crm/shared';
import { getApiSession } from '../../../../lib/api-auth';
import { getSupabaseServerClient } from '../../../../lib/supabase-server';
import { workspaceApiError } from '../../../../lib/workspace-api';
import { WorkspaceError } from '../../../../lib/record-scope';
import { isUuid } from '../../../../lib/workspace-validation';
import { socialDatabaseError } from '../../../../lib/social-marketing-errors';
import { readSocialUploadForm, processSocialImage } from '../../../../lib/social-image';

export const runtime = 'nodejs';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  try {
    const id = request.nextUrl.searchParams.get('id');
    const variant = request.nextUrl.searchParams.get('variant');
    const offset = Number(request.nextUrl.searchParams.get('offset') ?? 0);
    if ((id !== null && !isUuid(id)) || !Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647
      || (variant !== null && (id === null || !['image', 'thumbnail'].includes(variant)))) {
      throw new WorkspaceError('Choose a valid image or library page.', 400);
    }
    const { data, error } = await db.rpc('list_social_media', { p_actor: session.user.id, p_id: id, p_offset: offset });
    if (error) throw socialDatabaseError(error);
    if (!data) throw new WorkspaceError('The database returned no media data. Reload the library.', 500);
    if (id && variant) {
      const asset: SocialMediaAsset = data;
      if (asset.status !== 'ready') throw new WorkspaceError('This image is not ready. Check its upload status.', 409);
      const path = `${asset.workspace_id}/${asset.id}/${variant === 'image' ? 'image.jpg' : 'thumbnail.jpg'}`;
      const signed = await db.storage.from(SOCIAL_MEDIA_BUCKET).createSignedUrl(path, 60);
      if (signed.error || !signed.data?.signedUrl) {
        console.error('[social-media/preview]', signed.error);
        throw new WorkspaceError('Image preview could not load. Reload and try again.', 503);
      }
      const response = NextResponse.redirect(signed.data.signedUrl, 307);
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('Referrer-Policy', 'no-referrer');
      return response;
    }
    return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return workspaceApiError(error, 'social-media/read'); }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getApiSession(request);
  if (session.error) return session.error;
  const db = getSupabaseServerClient();
  if (!db) return NextResponse.json({ message: 'The CRM database is not connected.' }, { status: 503 });
  let reserved: SocialMediaAsset | null = null;
  try {
    // Verify workspace access before allocating or decoding the multipart body.
    const access = await db.rpc('list_social_media', { p_actor: session.user.id, p_id: null, p_offset: 0 });
    if (access.error) throw socialDatabaseError(access.error);
    const form = await readSocialUploadForm(request);
    if ([...form.keys()].some((key) => !['file', 'alt_text', 'rights_reference'].includes(key))
      || form.getAll('file').length !== 1 || form.getAll('alt_text').length !== 1 || form.getAll('rights_reference').length !== 1) {
      throw new WorkspaceError('Upload exactly one image with alt text and usage rights/source.', 400);
    }
    const file = form.get('file');
    const alt = form.get('alt_text');
    const rights = form.get('rights_reference');
    if (!(file instanceof File) || typeof alt !== 'string' || typeof rights !== 'string') {
      throw new WorkspaceError('Choose an image and complete its alt text and usage rights/source.', 400);
    }
    const invalid = socialMediaMetadataError({ file_name: file.name, alt_text: alt, rights_reference: rights });
    if (invalid) throw new WorkspaceError(invalid, 400);
    const reservation = await db.rpc('reserve_social_media', {
      p_actor: session.user.id, p_file_name: file.name, p_alt_text: alt.trim(), p_rights_reference: rights.trim(),
    });
    if (reservation.error) throw socialDatabaseError(reservation.error);
    if (!reservation.data) throw new WorkspaceError('The database did not reserve this upload. Retry.', 500);
    reserved = reservation.data;
    if (!reserved) throw new WorkspaceError('Upload reservation is missing.', 500);
    const processed = await processSocialImage(Buffer.from(await file.arrayBuffer()));
    const prefix = `${reserved.workspace_id}/${reserved.id}`;
    for (const [name, bytes] of [['image.jpg', processed.image], ['thumbnail.jpg', processed.thumbnail]] as const) {
      const stored = await db.storage.from(SOCIAL_MEDIA_BUCKET).upload(`${prefix}/${name}`, bytes, { contentType: 'image/jpeg', upsert: false });
      if (stored.error) {
        console.error('[social-media/upload]', stored.error);
        throw new WorkspaceError('Image storage failed. Upload the image again; contact the owner if it continues.', 503);
      }
    }
    const complete = await db.rpc('complete_social_media', {
      p_actor: session.user.id, p_id: reserved.id, p_width: processed.width, p_height: processed.height, p_bytes: processed.image.length,
    });
    if (complete.error) throw socialDatabaseError(complete.error);
    if (!complete.data) throw new WorkspaceError('The database did not confirm this image. Reload the library before retrying.', 500);
    return NextResponse.json(complete.data, { status: 201 });
  } catch (error) {
    if (reserved) {
      const persisted = await db.from('social_media_assets').select('status').eq('id', reserved.id)
        .eq('created_by', session.user.id).maybeSingle<{ status: SocialMediaAsset['status'] }>();
      if (persisted.error || !persisted.data) {
        console.error('[social-media/uncertain-state]', reserved.id, persisted.error);
        return workspaceApiError(new WorkspaceError('Upload outcome could not be verified. Reload the library and contact the owner before retrying.', 503), 'social-media/reconcile');
      }
      if (persisted.data.status === 'ready') {
        return workspaceApiError(new WorkspaceError('The image was saved, but its response could not be confirmed. Reload the library before retrying.', 503), 'social-media/reconcile');
      }
      const prefix = `${reserved.workspace_id}/${reserved.id}`;
      const removed = await db.storage.from(SOCIAL_MEDIA_BUCKET).remove([`${prefix}/image.jpg`, `${prefix}/thumbnail.jpg`]);
      if (removed.error) console.error('[social-media/cleanup]', reserved.id, removed.error);
      const failure = error instanceof WorkspaceError ? error.message : 'Upload failed. Upload the image again.';
      const failed = await db.rpc('fail_social_media', { p_actor: session.user.id, p_id: reserved.id, p_message: failure.slice(0, 500) });
      if (failed.error) console.error('[social-media/failed-state]', reserved.id, failed.error);
      if (removed.error || failed.error) {
        return workspaceApiError(new WorkspaceError('Upload failed and cleanup needs attention. Contact the CRM owner before retrying.', 503), 'social-media/cleanup');
      }
    }
    return workspaceApiError(error, 'social-media/upload');
  }
}
