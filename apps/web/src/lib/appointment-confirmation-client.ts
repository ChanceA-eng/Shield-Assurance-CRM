import { workspaceFetch } from './workspace-fetch';

export function sendAppointmentConfirmation(id: string, conversation: string): Promise<{ message: string }> {
  return workspaceFetch(`/api/events/${encodeURIComponent(id)}/confirmation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation, confirmed: true }),
  });
}
