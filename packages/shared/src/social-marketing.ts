import type { SocialReviewState } from './social-reviews.js';

export const SOCIAL_DRAFT_TITLE_LIMIT = 160;
export const SOCIAL_DRAFT_CAPTION_LIMIT = 10000;

export interface SocialDraftContent {
  title: string;
  caption: string;
  link_url?: string | null;
  media_ids?: string[];
}

export interface SocialDraft extends SocialDraftContent {
  id: string;
  workspace_id: string;
  revision: number;
  status: 'draft' | 'archived';
  review_state: SocialReviewState;
  review_version: number;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
}

export interface SocialDraftRevision extends SocialDraftContent {
  revision: number;
  action: 'created' | 'edited' | 'archived';
  actor_id: string;
  recorded_at: string;
}

export type SocialDraftCommand =
  | ({ action: 'create'; id: string } & SocialDraftContent)
  | ({ action: 'update'; id: string; expected_revision: number } & SocialDraftContent)
  | { action: 'archive'; id: string; expected_revision: number };

export type SocialDraftValidation =
  | { command: SocialDraftCommand; error: null }
  | { command: null; error: string };

export function validateSocialDraftCommand(value: unknown): SocialDraftValidation {
  const invalid = (error: string): SocialDraftValidation => ({ command: null, error });
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Send a JSON object.');
  const body: Record<string, unknown> = { ...value };
  const action = body.action;
  if (action !== 'create' && action !== 'update' && action !== 'archive') return invalid('Choose a valid draft action.');
  const allowed = action === 'archive' ? ['action', 'id', 'expected_revision']
    : action === 'create' ? ['action', 'id', 'title', 'caption', 'link_url', 'media_ids'] : ['action', 'id', 'title', 'caption', 'link_url', 'expected_revision', 'media_ids'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) return invalid('An unsupported draft field was supplied.');
  if (typeof body.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)) {
    return invalid('A valid draft id is required.');
  }
  if (action !== 'create' && (typeof body.expected_revision !== 'number' || !Number.isInteger(body.expected_revision)
    || body.expected_revision < 1 || body.expected_revision >= 2147483647)) {
    return invalid('A valid draft revision is required. Reload the draft.');
  }
  if (action === 'archive' && typeof body.expected_revision === 'number') {
    return { command: { action, id: body.id, expected_revision: body.expected_revision }, error: null };
  }
  if (typeof body.title !== 'string' || !body.title.trim() || [...body.title.trim()].length > SOCIAL_DRAFT_TITLE_LIMIT) {
    return invalid(`Enter a title of 1-${SOCIAL_DRAFT_TITLE_LIMIT} characters.`);
  }
  if (typeof body.caption !== 'string' || [...body.caption].length > SOCIAL_DRAFT_CAPTION_LIMIT || body.caption.includes('\u0000')
    || body.title.includes('\u0000')) {
    return invalid(`Enter a caption of up to ${SOCIAL_DRAFT_CAPTION_LIMIT} characters without null characters.`);
  }
  let linkUrl: string | null = null;
  if (body.link_url !== undefined && body.link_url !== null && body.link_url !== '') {
    if (typeof body.link_url !== 'string' || body.link_url.length > 2048 || body.link_url.includes('\u0000')) {
      return invalid('Enter a valid HTTPS link up to 2,048 characters.');
    }
    try {
      const url = new URL(body.link_url);
      if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return invalid('Use a public HTTPS link without embedded credentials.');
      linkUrl = url.toString();
    } catch { return invalid('Enter a valid HTTPS link.'); }
  }
  let mediaIds: string[] | undefined;
  if (body.media_ids !== undefined) {
    if (!Array.isArray(body.media_ids) || body.media_ids.length > SOCIAL_MEDIA_MAX_ATTACHMENTS
      || !body.media_ids.every((id): id is string => typeof id === 'string'
        && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
      return invalid(`Choose up to ${SOCIAL_MEDIA_MAX_ATTACHMENTS} ready image from the media library.`);
    }
    mediaIds = body.media_ids;
  }
  const content = {
    id: body.id, title: body.title.trim(), caption: body.caption, link_url: linkUrl,
    ...(mediaIds === undefined ? {} : { media_ids: mediaIds }),
  };
  if (action === 'create') return { command: { action, ...content }, error: null };
  if (action === 'update' && typeof body.expected_revision === 'number') {
    return { command: { action, ...content, expected_revision: body.expected_revision }, error: null };
  }
  return invalid('Choose a valid draft action.');
}
import { SOCIAL_MEDIA_MAX_ATTACHMENTS } from './social-media.js';
