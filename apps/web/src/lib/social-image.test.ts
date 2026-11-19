import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { processSocialImage, readSocialUploadForm } from './social-image';
import { SOCIAL_IMAGE_MAX_BYTES } from '@crm/shared';

describe('Social image pipeline', () => {
  it('decodes PNG, flattens transparency and produces metadata-free JPEG and thumbnail', async () => {
    const original = await sharp({ create: { width: 640, height: 480, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png().withMetadata().toBuffer();
    const result = await processSocialImage(original);
    expect(result).toMatchObject({ width: 640, height: 480 });
    const metadata = await sharp(result.image).metadata();
    expect(metadata.format).toBe('jpeg');
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.hasAlpha).toBe(false);
    const preview = await sharp(result.thumbnail).metadata();
    expect(preview.width).toBe(320);
    expect(preview.height).toBe(240);
    expect(result.thumbnail.length).toBeLessThanOrEqual(102400);
  });
  it('auto-orients and bounds a large JPEG', async () => {
    const original = await sharp({ create: { width: 5000, height: 1000, channels: 3, background: 'blue' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const result = await processSocialImage(original);
    expect(result.width).toBe(819);
    expect(result.height).toBe(4096);
    expect((await sharp(result.image).metadata()).orientation).toBeUndefined();
  });
  it.each([Buffer.from('<svg/>'), Buffer.from('GIF89a'), Buffer.from('renamed file'), Buffer.from([255, 216, 255]), Buffer.alloc(0)])
    ('rejects unsupported or corrupt file bytes', async (bytes) => {
      await expect(processSocialImage(bytes)).rejects.toThrow();
    });
  it('enforces source byte limits', async () => {
    await expect(processSocialImage(Buffer.alloc(SOCIAL_IMAGE_MAX_BYTES + 1))).rejects.toMatchObject({ status: 413 });
  });
  it('rejects a decompression-sized image before pixel processing', async () => {
    const original = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: 'white' } }).png().toBuffer();
    await expect(processSocialImage(original)).rejects.toMatchObject({ status: 400 });
  });
  it('bounds streamed request bytes even without a content-length header', async () => {
    const request = new Request('https://crm.invalid/upload', {
      method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
      body: new Uint8Array(SOCIAL_IMAGE_MAX_BYTES + 65537),
    });
    await expect(readSocialUploadForm(request)).rejects.toMatchObject({ status: 413 });
  });
  it('reads valid multipart and rejects malformed encoding', async () => {
    const form = new FormData();
    form.set('alt_text', 'Agency image');
    const result = await readSocialUploadForm(new Request('https://crm.invalid/upload', { method: 'POST', body: form }));
    expect(result.get('alt_text')).toBe('Agency image');
    await expect(readSocialUploadForm(new Request('https://crm.invalid/upload', {
      method: 'POST', body: 'broken', headers: { 'Content-Type': 'multipart/form-data; boundary=test' },
    }))).rejects.toMatchObject({ status: 400 });
  });
});
