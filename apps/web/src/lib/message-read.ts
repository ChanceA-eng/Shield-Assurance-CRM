/** Browser-safe helpers for rendering message status truthfully and marking viewed messages read. */

export interface MessageLike {
  id: string;
  channel: string | null;
  direction: string | null;
  automation_type?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function messageStatusLabel(message: MessageLike): string {
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {};
  if ((message.direction ?? 'outbound') === 'inbound') {
    return metadata.recorded_manually ? 'Received · recorded manually' : 'Received';
  }
  if (metadata.delivery_status === 'accepted_by_provider') {
    const provider = typeof metadata.provider === 'string' ? metadata.provider : 'provider';
    return `Accepted by ${provider === 'gmail' ? 'Gmail' : provider === 'sendgrid' ? 'SendGrid' : provider}`;
  }
  if (message.channel === 'sms') return 'Logged only · not sent';
  if (message.automation_type === 'outreach_sequence') return 'Sequence email';
  return 'Outbound · recorded';
}

export type MarkReadResult = { ok: true; updated: number } | { ok: false; message: string };

/** Marks exactly the given inbound messages read. Callers should only pass ids the user has seen. */
export async function markMessagesRead(ids: string[], fetcher: typeof fetch = fetch): Promise<MarkReadResult> {
  if (ids.length === 0) return { ok: true, updated: 0 };
  try {
    let updated = 0;
    for (let offset = 0; offset < ids.length; offset += 500) {
    const response = await fetcher('/api/communication-log', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read_ids: ids.slice(offset, offset + 500) }),
    });
    const payload = (await response.json().catch(() => ({}))) as { updated?: number; message?: string };
    if (!response.ok) return { ok: false, message: payload.message ?? `Could not mark messages read (${response.status}).` };
      if (typeof payload.updated !== 'number') return { ok: false, message: 'The server did not confirm the read acknowledgement. Refresh the conversation.' };
      updated += payload.updated;
    }
    return { ok: true, updated };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? `Could not mark messages read: ${error.message}` : 'Could not mark messages read.' };
  }
}

export async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as { message?: string };
  return payload.message ?? `${fallback} (${response.status})`;
}
