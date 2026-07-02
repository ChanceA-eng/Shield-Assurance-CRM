import { getSupabaseServerClient } from './supabase-server';

const RASHI_STORAGE_BUCKET = process.env.RASHI_STORAGE_BUCKET || 'rashi-knowledge-assets';

function sanitizeFileName(fileName: string): string {
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function uploadRashiSourceFile(
  file: File,
  folder: 'documents' | 'source-files' = 'documents',
): Promise<{ bucket: string; objectPath: string; publicUrl: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    throw new Error('Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }

  const baseName = sanitizeFileName(file.name || 'asset-upload') || 'asset-upload';
  const objectPath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${baseName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(RASHI_STORAGE_BUCKET).upload(objectPath, buffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (uploadError) {
    throw new Error(`Failed to upload source file to Supabase Storage: ${uploadError.message}`);
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(RASHI_STORAGE_BUCKET).getPublicUrl(objectPath);

  if (!publicUrl) {
    throw new Error('Supabase Storage upload succeeded, but no public URL was returned.');
  }

  return {
    bucket: RASHI_STORAGE_BUCKET,
    objectPath,
    publicUrl,
  };
}