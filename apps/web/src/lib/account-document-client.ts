/** Browser-side account document upload/download. Every step's failure is surfaced; nothing is recorded until bytes are stored. */

export interface AccountDocumentView {
  id: string;
  client_id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  status: string;
  source_kind: 'stored' | 'link' | 'legacy_placeholder';
  file_url: string | null;
  download_url: string | null;
  content_type: string | null;
  uploaded_by: string | null;
  uploaded_at: string | null;
  notes: string | null;
}

export type ClientResult<T> = ({ ok: true } & T) | { ok: false; message: string };

interface UploadTicketResponse {
  upload: { storage_path: string; signed_url: string; token: string; content_type: string };
  file: { file_name: string; content_type: string; file_size: number };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  return payload.message ?? `${fallback} (${response.status})`;
}

function putToSignedUrl(url: string, file: Blob, fileName: string, contentType: string, onProgress?: (fraction: number) => void): Promise<ClientResult<object>> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('x-upsert', 'false');
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) {
      xhr.setRequestHeader('apikey', anonKey);
      xhr.setRequestHeader('Authorization', `Bearer ${anonKey}`);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({ ok: true });
        return;
      }
      let detail = xhr.statusText || `status ${xhr.status}`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        detail = parsed.message ?? parsed.error ?? detail;
      } catch {
        // Non-JSON storage error body.
      }
      resolve({ ok: false, message: `Storage rejected the upload: ${detail}` });
    };
    xhr.onerror = () => resolve({ ok: false, message: 'The upload was interrupted. Check your connection and try again.' });
    xhr.onabort = () => resolve({ ok: false, message: 'The upload was cancelled.' });
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', new Blob([file], { type: contentType }), fileName);
    xhr.send(form);
  });
}

const pendingConfirmations = new WeakMap<File, { clientId: string; ticket: UploadTicketResponse }>();

export async function uploadAccountDocument(
  clientId: string,
  file: File,
  options: { notes?: string; onProgress?: (fraction: number) => void } = {},
): Promise<ClientResult<{ document: AccountDocumentView }>> {
  const base = `/api/clients/${encodeURIComponent(clientId)}/files`;
  try {
    const pending = pendingConfirmations.get(file);
    let ticket = pending?.clientId === clientId ? pending.ticket : undefined;
    if (!ticket) {
      const ticketResponse = await fetch(`${base}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: file.name, content_type: file.type, file_size: file.size }),
      });
      if (!ticketResponse.ok) return { ok: false, message: await errorMessage(ticketResponse, 'Upload could not start') };
      ticket = (await ticketResponse.json()) as UploadTicketResponse;

      const put = await putToSignedUrl(ticket.upload.signed_url, file, ticket.file.file_name, ticket.upload.content_type, options.onProgress);
      if (!put.ok) return put;
      pendingConfirmations.set(file, { clientId, ticket });
    }

    const completeResponse = await fetch(`${base}/upload/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storage_path: ticket.upload.storage_path,
        file_name: ticket.file.file_name,
        content_type: ticket.file.content_type,
        file_size: ticket.file.file_size,
        notes: options.notes,
      }),
    });
    if (!completeResponse.ok) {
      if (completeResponse.status === 409) pendingConfirmations.delete(file);
      return { ok: false, message: await errorMessage(completeResponse, 'The upload could not be confirmed') };
    }
    const document = (await completeResponse.json()) as AccountDocumentView;
    pendingConfirmations.delete(file);
    return { ok: true, document };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `Upload failed: ${error.message}` : 'Upload failed.' };
  }
}

/** Fetches the private file through the authenticated route so failures show an error instead of a broken tab. */
export async function downloadAccountDocument(document: Pick<AccountDocumentView, 'download_url' | 'file_name'>, mode: 'attachment' | 'inline' = 'attachment'): Promise<ClientResult<object>> {
  if (!document.download_url) return { ok: false, message: 'This document has no stored file to download.' };
  try {
    const response = await fetch(`${document.download_url}${mode === 'inline' ? '?disposition=inline' : ''}`, { cache: 'no-store' });
    if (!response.ok) return { ok: false, message: await errorMessage(response, 'Download failed') };
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    if (mode === 'inline') {
      const opened = window.open('about:blank', '_blank');
      if (!opened) {
        URL.revokeObjectURL(url);
        return { ok: false, message: 'The browser blocked the preview window. Allow pop-ups or download instead.' };
      }
      opened.opener = null;
      opened.location.replace(url);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { ok: true };
    }
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = document.file_name;
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `Download failed: ${error.message}` : 'Download failed.' };
  }
}

export function formatBytes(size: number | null | undefined): string {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
