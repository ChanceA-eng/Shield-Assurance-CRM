export const SOCIAL_MEDIA_BUCKET = 'social-marketing-media';
export const SOCIAL_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
export const SOCIAL_IMAGE_MAX_PIXELS = 20_000_000;
export const SOCIAL_MEDIA_MAX_ATTACHMENTS = 1;

export interface SocialMediaAsset {
  id: string;
  workspace_id: string;
  file_name: string;
  alt_text: string;
  rights_reference: string;
  status: 'processing' | 'ready' | 'failed';
  width: number | null;
  height: number | null;
  byte_size: number | null;
  error_message: string | null;
  created_by: string;
  created_at: string;
}

export interface SocialMediaList {
  assets: SocialMediaAsset[];
  total: number;
}

export function socialMediaMetadataError(value: { file_name: unknown; alt_text: unknown; rights_reference: unknown }): string | null {
  for (const [name, field, max] of [
    ['File name', value.file_name, 180],
    ['Alt text', value.alt_text, 1000],
    ['Usage rights/source', value.rights_reference, 1000],
  ] as const) {
    if (typeof field !== 'string' || !field.trim() || [...field.trim()].length > max || field.includes('\u0000')) {
      return `${name} must contain 1-${max} characters without null characters.`;
    }
  }
  return null;
}
