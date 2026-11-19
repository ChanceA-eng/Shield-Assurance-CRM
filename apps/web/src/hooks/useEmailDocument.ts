'use client';
import { useState } from 'react';
import { emailDocumentText, type EmailDocument } from '@crm/shared';

export function useEmailDocument(body: string) {
  const [document, setDocument] = useState<EmailDocument>();
  return { bodyDocument: document && emailDocumentText(document) === body ? document : undefined, setBodyDocument: setDocument };
}
