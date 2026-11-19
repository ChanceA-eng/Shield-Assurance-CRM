import sharp from 'sharp';
import { SOCIAL_IMAGE_MAX_BYTES, SOCIAL_IMAGE_MAX_PIXELS } from '@crm/shared';
import { WorkspaceError } from './record-scope';

export interface ProcessedSocialImage {
  image: Buffer;
  thumbnail: Buffer;
  width: number;
  height: number;
}

export async function readSocialUploadForm(request: Request): Promise<FormData> {
  const maxRequestBytes = SOCIAL_IMAGE_MAX_BYTES + 64 * 1024;
  const size = request.headers.get('content-length');
  if (size !== null && (!/^\d+$/.test(size) || Number(size) > maxRequestBytes)) {
    throw new WorkspaceError('Upload one JPEG or PNG image of up to 4 MB.', 413);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('multipart/form-data;')) {
    throw new WorkspaceError('Upload the image using a multipart form.', 400);
  }
  if (!request.body) throw new WorkspaceError('Choose an image to upload.', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maxRequestBytes) {
        await reader.cancel();
        throw new WorkspaceError('Upload one JPEG or PNG image of up to 4 MB.', 413);
      }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const body = new ArrayBuffer(length);
  const bytes = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return await new Request(request.url, { method: 'POST', headers: request.headers, body }).formData(); }
  catch (error) {
    console.error('[social-media/form]', error);
    throw new WorkspaceError('The upload form could not be read. Choose the image again.', 400);
  }
}

export async function processSocialImage(input: Buffer): Promise<ProcessedSocialImage> {
  if (!input.length || input.length > SOCIAL_IMAGE_MAX_BYTES) throw new WorkspaceError('Choose an image of 1 byte to 4 MB.', 413);
  const jpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
  const png = input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (!jpeg && !png) throw new WorkspaceError('Only actual JPEG and PNG images are supported. SVG, GIF, and renamed files are not accepted.', 400);
  try {
    const pipeline = sharp(input, { limitInputPixels: SOCIAL_IMAGE_MAX_PIXELS, failOn: 'warning' }).timeout({ seconds: 15 });
    const metadata = await pipeline.metadata();
    if ((metadata.format !== 'jpeg' && metadata.format !== 'png') || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height
      || metadata.width > 8192 || metadata.height > 8192 || metadata.width * metadata.height > SOCIAL_IMAGE_MAX_PIXELS) {
      throw new WorkspaceError('Choose a still JPEG/PNG image up to 8192 pixels per side and 20 megapixels.', 400);
    }
    const result = await pipeline.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true });
    if (result.data.length > SOCIAL_IMAGE_MAX_BYTES) throw new WorkspaceError('The processed image exceeds 4 MB. Upload a smaller image.', 413);
    const thumbnail = await sharp(result.data).timeout({ seconds: 10 })
      .resize({ width: 320, height: 320, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer();
    if (thumbnail.length > 102400) throw new WorkspaceError('The preview is too large. Upload a simpler image.', 413);
    return { image: result.data, thumbnail, width: result.info.width, height: result.info.height };
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    console.error('[social-media/decode]', error);
    throw new WorkspaceError('The image could not be safely decoded. Choose a valid, non-animated JPEG or PNG within the image limits.', 400);
  }
}
