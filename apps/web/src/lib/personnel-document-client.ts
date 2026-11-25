import { putToSignedUrl } from './account-document-client';
import { workspaceFetch } from './workspace-fetch';

export interface PersonnelUpload {
  ticket: { id: string; signed_url: string; content_type: string; confirmation: string };
  member: string;
  file: File;
  retain: string;
  shared: boolean;
  uploaded: boolean;
}

export async function finishPersonnelUpload(upload: PersonnelUpload, markUploaded: () => void): Promise<void> {
  let uploadError: string | undefined;
  if (!upload.uploaded) {
    const result = await putToSignedUrl(upload.ticket.signed_url, upload.file, upload.file.name, upload.ticket.content_type);
    if (result.ok) markUploaded();
    else uploadError = result.message;
  }
  try {
    await workspaceFetch('/api/personnel-documents', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', id: upload.ticket.id, member: upload.member, file_name: upload.file.name,
        file_size: upload.file.size, content_type: upload.ticket.content_type, retain_until: upload.retain,
        shared: upload.shared, confirmation: upload.ticket.confirmation }),
    });
  } catch (problem) {
    const message = problem instanceof Error ? problem.message : 'Document confirmation failed.';
    throw new Error(uploadError ? `${uploadError} ${message}` : message);
  }
}
