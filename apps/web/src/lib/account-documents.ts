import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export const ACCOUNT_DOCUMENT_BUCKET = process.env.ACCOUNT_DOCUMENTS_BUCKET?.trim() || 'account-documents';
export const MAX_ACCOUNT_DOCUMENT_BYTES = 25 * 1024 * 1024;
export const UPLOAD_TICKET_TTL_SECONDS = 2 * 60 * 60;
export const CLIENT_FILE_COLUMNS = 'id,client_id,file_name,file_url,file_type,file_size,status,metadata,uploaded_at,created_at';

/** MIME allowlist mirrored by the bucket's allowed_mime_types in the storage migration. */
export const ACCOUNT_DOCUMENT_MIME_TYPES: Record<string, DocumentTypeLabel> = {
  'application/pdf': 'PDF',
  'image/jpeg': 'IMAGE',
  'image/png': 'IMAGE',
  'image/gif': 'IMAGE',
  'image/webp': 'IMAGE',
  'image/heic': 'IMAGE',
  'image/heif': 'IMAGE',
  'image/tiff': 'IMAGE',
  'application/msword': 'WORD',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'WORD',
  'application/vnd.ms-excel': 'SPREADSHEET',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'SPREADSHEET',
  'text/csv': 'SPREADSHEET',
  'text/plain': 'TEXT',
};

const EXTENSION_MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
};

export type DocumentTypeLabel = 'PDF' | 'IMAGE' | 'WORD' | 'SPREADSHEET' | 'TEXT' | 'OTHER';
export type DocumentSourceKind = 'stored' | 'link' | 'legacy_placeholder';

export interface StoredDocumentLocation {
  bucket: string;
  path: string;
  content_type: string;
  size: number;
}

export interface ClientFileRecord {
  id: string;
  client_id: string;
  file_name: string;
  file_url: string | null;
  file_type: string | null;
  file_size: number | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  uploaded_at: string | null;
  created_at: string | null;
}

export interface ClientFileView {
  id: string;
  client_id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: string;
  source_kind: DocumentSourceKind;
  /** External reference URL; only present for link records. */
  file_url: string | null;
  /** Authenticated download route; only present for privately stored bytes. */
  download_url: string | null;
  content_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  notes: string | null;
}

export type Result<T> = ({ ok: true } & T) | { ok: false; status: number; message: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : '';
}

export function sanitizeDocumentName(fileName: string): string {
  const trimmed = fileName.trim().split(/[\\/]/).pop() ?? '';
  const cleaned = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120);
  return cleaned || 'document';
}

/** Resolves a usable MIME type from the browser-reported type or the extension. */
export function resolveDocumentContentType(fileName: string, reported?: string | null): string | null {
  const normalized = (reported ?? '').trim().toLowerCase();
  if (normalized && ACCOUNT_DOCUMENT_MIME_TYPES[normalized]) return normalized;
  const fromExtension = EXTENSION_MIME_TYPES[extensionOf(fileName)];
  return fromExtension ?? null;
}

export function documentTypeLabel(contentType: string | null | undefined): DocumentTypeLabel {
  return (contentType && ACCOUNT_DOCUMENT_MIME_TYPES[contentType.toLowerCase()]) || 'OTHER';
}

export function validateUploadRequest(input: {
  fileName?: unknown;
  contentType?: unknown;
  size?: unknown;
}): Result<{ fileName: string; contentType: string; size: number }> {
  const fileName = typeof input.fileName === 'string' ? input.fileName.trim() : '';
  if (!fileName) return { ok: false, status: 400, message: 'Choose a file to upload.' };
  if (fileName.length > 255) return { ok: false, status: 400, message: 'File name is too long (255 characters maximum).' };
  const size = typeof input.size === 'number' ? input.size : Number.NaN;
  if (!Number.isFinite(size) || size <= 0) return { ok: false, status: 400, message: 'The selected file is empty.' };
  if (size > MAX_ACCOUNT_DOCUMENT_BYTES) {
    return { ok: false, status: 413, message: `Files must be ${MAX_ACCOUNT_DOCUMENT_BYTES / (1024 * 1024)} MB or smaller.` };
  }
  const contentType = resolveDocumentContentType(fileName, typeof input.contentType === 'string' ? input.contentType : null);
  if (!contentType) {
    return { ok: false, status: 415, message: 'Unsupported file type. Upload a PDF, image, Word, Excel, CSV or text file.' };
  }
  return { ok: true, fileName, contentType, size };
}

export function buildDocumentObjectPath(clientId: string, fileName: string, uploadId: string = randomUUID()): string {
  return `clients/${clientId}/${uploadId}/${sanitizeDocumentName(fileName)}`;
}

/** Upload completion may only reference an object path issued for this account. */
export function isDocumentPathForClient(path: unknown, clientId: string): path is string {
  if (typeof path !== 'string') return false;
  const parts = path.split('/');
  return parts.length === 4
    && parts[0] === 'clients'
    && parts[1] === clientId
    && isUuid(parts[2])
    && /^[a-z0-9._-]+$/.test(parts[3])
    && !parts[3].startsWith('.');
}

export function validateExternalUrl(value: unknown): Result<{ url: string }> {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { ok: false, status: 400, message: 'Enter the document link (https://...).' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, status: 400, message: 'Enter a valid web address starting with https://.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, status: 400, message: 'Only http(s) links can be saved as references. Upload the file to store it.' };
  }
  return { ok: true, url: parsed.toString() };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function storedLocation(record: Pick<ClientFileRecord, 'metadata'>): StoredDocumentLocation | null {
  const metadata = asRecord(record.metadata);
  const storage = asRecord(metadata.storage);
  if (metadata.source_kind !== 'stored') return null;
  if (typeof storage.bucket !== 'string' || typeof storage.path !== 'string') return null;
  return {
    bucket: storage.bucket,
    path: storage.path,
    content_type: typeof storage.content_type === 'string' ? storage.content_type : 'application/octet-stream',
    size: typeof storage.size === 'number' ? storage.size : 0,
  };
}

export function classifyClientFile(record: Pick<ClientFileRecord, 'metadata' | 'file_url'>): DocumentSourceKind {
  if (storedLocation(record)) return 'stored';
  const url = (record.file_url ?? '').trim();
  if (/^https?:\/\//i.test(url)) return 'link';
  return 'legacy_placeholder';
}

export function documentDownloadHref(clientId: string, fileId: string): string {
  return `/api/clients/${encodeURIComponent(clientId)}/files/${encodeURIComponent(fileId)}/download`;
}

export function toClientFileView(record: ClientFileRecord): ClientFileView {
  const kind = classifyClientFile(record);
  const metadata = asRecord(record.metadata);
  const location = storedLocation(record);
  const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim() : null);
  return {
    id: record.id,
    client_id: record.client_id,
    file_name: record.file_name,
    file_type: record.file_type,
    file_size: record.file_size,
    status: kind === 'legacy_placeholder' ? 'not_uploaded' : kind === 'stored' ? 'stored' : 'linked',
    source_kind: kind,
    file_url: kind === 'link' ? record.file_url : null,
    download_url: kind === 'stored' ? documentDownloadHref(record.client_id, record.id) : null,
    content_type: location?.content_type ?? null,
    uploaded_by: text(metadata.uploaded_by) ?? text(metadata.added_by),
    uploaded_at: record.uploaded_at ?? record.created_at,
    notes: text(metadata.notes),
  };
}

export function contentDisposition(fileName: string, mode: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = fileName.replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, '_') || 'document';
  return `${mode}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export interface UploadTicket {
  bucket: string;
  path: string;
  token: string;
  signedUrl: string;
  contentType: string;
  expiresInSeconds: number;
}

export async function createDocumentUploadTicket(
  supabase: SupabaseClient,
  input: { clientId: string; fileName: string; contentType: string },
): Promise<Result<{ ticket: UploadTicket }>> {
  const path = buildDocumentObjectPath(input.clientId, input.fileName);
  const { data, error } = await supabase.storage.from(ACCOUNT_DOCUMENT_BUCKET).createSignedUploadUrl(path);
  if (error || !data?.signedUrl || !data.token) {
    return { ok: false, status: 502, message: `Document storage is unavailable: ${error?.message ?? 'no upload URL was issued.'}` };
  }
  return {
    ok: true,
    ticket: {
      bucket: ACCOUNT_DOCUMENT_BUCKET,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      contentType: input.contentType,
      expiresInSeconds: UPLOAD_TICKET_TTL_SECONDS,
    },
  };
}

/** Confirms the bytes actually exist in private storage before any record claims they do. */
export async function verifyStoredObject(
  supabase: SupabaseClient,
  path: string,
  expectedSize: number,
): Promise<Result<{ size: number; contentType: string | null }>> {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(ACCOUNT_DOCUMENT_BUCKET).list(folder, { limit: 10, search: name });
  if (error) return { ok: false, status: 502, message: `Could not confirm the upload: ${error.message}` };
  const object = (data ?? []).find((item) => item.name === name);
  if (!object) return { ok: false, status: 409, message: 'The file did not finish uploading. Try the upload again.' };
  const metadata = asRecord(object.metadata);
  const size = typeof metadata.size === 'number' ? metadata.size : Number(metadata.contentLength ?? Number.NaN);
  if (!Number.isFinite(size) || size !== expectedSize) {
    return { ok: false, status: 409, message: 'The stored file size does not match the selected file. Try the upload again.' };
  }
  const contentType = typeof metadata.mimetype === 'string' ? metadata.mimetype : null;
  return { ok: true, size, contentType };
}

export async function removeStoredObject(supabase: SupabaseClient, location: { bucket: string; path: string }): Promise<Result<object>> {
  const { error } = await supabase.storage.from(location.bucket).remove([location.path]);
  if (error) return { ok: false, status: 502, message: `Could not remove the stored file: ${error.message}` };
  return { ok: true };
}

export async function downloadStoredObject(
  supabase: SupabaseClient,
  location: { bucket: string; path: string },
): Promise<Result<{ blob: Blob }>> {
  const { data, error } = await supabase.storage.from(location.bucket).download(location.path);
  if (error || !data) {
    const message = error?.message ?? 'No file data was returned.';
    const missing = /not.?found|404/i.test(message);
    return {
      ok: false,
      status: missing ? 404 : 502,
      message: missing ? 'The stored file could not be found. It may have been removed from storage.' : `Download failed: ${message}`,
    };
  }
  return { ok: true, blob: data };
}
