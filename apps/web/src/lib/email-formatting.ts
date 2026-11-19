import { emailDocumentText, parseEmailDocument, parseEmailRows, type EmailFormatting } from '@crm/shared';
import type { SupabaseClient } from '@supabase/supabase-js';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';

export function messageDocument(value: unknown, body: string) {
  try {
    const doc = parseEmailDocument(value);
    if (doc && emailDocumentText(doc).trim() !== body.trim()) throw new Error('Formatting no longer matches the message. Review it before sending.');
    return doc;
  } catch (error) {
    throw new WorkspaceError(error instanceof Error ? error.message : 'Invalid email formatting.', 400);
  }
}
export async function signatureFormatting(db: SupabaseClient, actor: string): Promise<EmailFormatting> {
  const { data, error } = await db.from('email_signature_designs').select('document,rows').eq('user_id', actor).maybeSingle();
  if (error) throw databaseError(error);
  if (!data) return {};
  return { signatureDocument: parseEmailDocument(data.document), signatureRows: data.rows ? parseEmailRows(data.rows) : undefined };
}
