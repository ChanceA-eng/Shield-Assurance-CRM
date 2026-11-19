import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment } from './appointment-lifecycle';
import { appointmentWindow } from './appointment-lifecycle';
import { WorkspaceError } from './record-scope';
import { databaseError } from './workspace-api';
import { isRecord } from './workspace-validation';
import { ZoomHttpError, zoomAuthorizedRequest } from './zoom-provider';

export function zoomJoinUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us'))
      && !url.username && !url.password && /^\/j\/\d+/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}
function meetingId(row: Record<string, unknown>): string {
  const id = String(row.id ?? '');
  if (!/^\d{9,15}$/.test(id)) throw new WorkspaceError('Zoom returned an incomplete meeting. Retry sync.', 503);
  return id;
}
async function remoteMeeting(request: (path: string, init?: RequestInit) => Promise<unknown>, id: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await request(`/meetings/${encodeURIComponent(id)}`);
    if (!isRecord(result)) throw new WorkspaceError('Zoom returned an incomplete meeting. Retry sync.', 503);
    return result;
  } catch (error) {
    if (error instanceof ZoomHttpError && error.providerStatus === 404) return null;
    throw error;
  }
}
export async function syncZoomMeeting(
  db: SupabaseClient, event: Appointment, lock: string, recovery?: { confirmedMissing: true; revision: number },
): Promise<{ zoom_meeting_id: string | null; zoom_join_url: string | null; zoom_create_attempted_at?: string | null }> {
  const actor = event.user_id, marker = `[CRM appointment ${event.id}]`;
  if (recovery && recovery.revision !== event.revision) throw new WorkspaceError('This appointment changed. Refresh before resolving Zoom creation.', 409);
  if (!event.zoom_meeting_id && !event.zoom_create_attempted_at && (event.status === 'cancelled' || event.meeting_type !== 'zoom')) {
    return { zoom_meeting_id: null, zoom_join_url: null };
  }
  const request = await zoomAuthorizedRequest(db, actor);
  const persist = async (patch: Record<string, unknown>) => {
    const saved = await db.from('events').update(patch).eq('id', event.id).eq('user_id', actor)
      .eq('revision', event.revision).eq('sync_lock', lock).gt('sync_lease_until', new Date().toISOString()).select('id').maybeSingle();
    if (saved.error) throw databaseError(saved.error);
    if (!saved.data) throw new WorkspaceError('Appointment sync changed. Refresh before retrying.', 409);
  };
  let id = event.zoom_meeting_id ?? null;
  if (!id && event.zoom_create_attempted_at) {
    let page = '';
    const matches: Record<string, unknown>[] = [];
    for (let count = 0; count < 10; count++) {
      const params = new URLSearchParams({ type: 'scheduled', page_size: '300' });
      if (page) params.set('next_page_token', page);
      const result = await request(`/users/me/meetings?${params}`);
      if (!isRecord(result) || !Array.isArray(result.meetings)) throw new WorkspaceError('Zoom meeting recovery is unavailable. Retry sync.', 503);
      matches.push(...result.meetings.filter((row): row is Record<string, unknown> => isRecord(row) && row.agenda === marker));
      page = typeof result.next_page_token === 'string' ? result.next_page_token : '';
      if (!page) break;
    }
    if (page || matches.length > 1 || !matches.length && !recovery) {
      throw new WorkspaceError('Zoom creation could not be confirmed. Check your Zoom meetings before retrying; no duplicate meeting was created.', 409);
    }
    if (matches.length) {
      id = meetingId(matches[0]);
      await persist({ zoom_meeting_id: id });
    } else {
      await persist({ zoom_create_attempted_at: null });
    }
  }
  const remove = event.status === 'cancelled' || event.meeting_type !== 'zoom';
  if (remove) {
    if (id) {
      try { await request(`/meetings/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
      catch (error) { if (!(error instanceof ZoomHttpError && error.providerStatus === 404)) throw error; }
    }
    return { zoom_meeting_id: event.status === 'cancelled' ? id : null, zoom_join_url: null, zoom_create_attempted_at: null };
  }
  const { start } = appointmentWindow(event);
  const body = {
    topic: event.subject, type: 2, start_time: start, duration: event.duration_minutes, timezone: event.time_zone,
    agenda: marker, settings: { use_pmi: false, waiting_room: true, join_before_host: false, auto_recording: 'none' },
  };
  let remote: Record<string, unknown> | null;
  if (id) {
    remote = await remoteMeeting(request, id);
    if (!remote) throw new WorkspaceError('This Zoom meeting was deleted outside the CRM. Cancel this appointment and book a new one.', 409);
    await request(`/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  } else {
    await persist({ zoom_create_attempted_at: new Date().toISOString() });
    let created: unknown;
    try { created = await request('/users/me/meetings', { method: 'POST', body: JSON.stringify(body) }); }
    catch (error) {
      // Only a definitive rejection is safe to retry. Unknown outcomes must
      // reconcile against the marker instead of issuing another create.
      if (error instanceof ZoomHttpError && error.providerStatus >= 400 && error.providerStatus < 500 && error.providerStatus !== 408) {
        await persist({ zoom_create_attempted_at: null });
      }
      throw error;
    }
    if (!isRecord(created)) throw new WorkspaceError('Zoom creation could not be confirmed. Retry sync to recover the meeting.', 503);
    id = meetingId(created); remote = created;
    await persist({ zoom_meeting_id: id });
  }
  const join = zoomJoinUrl(remote.join_url) ?? zoomJoinUrl((await remoteMeeting(request, id))?.join_url);
  if (!join) throw new WorkspaceError('Zoom has not returned a valid join link. Retry sync before sending confirmation.', 503);
  return { zoom_meeting_id: id, zoom_join_url: join };
}
