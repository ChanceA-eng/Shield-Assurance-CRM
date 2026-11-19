import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calendarRequest, calendarBusy, CalendarHttpError } from './google-calendar';
import { ownZoomConnection, zoomAuthorizedRequest, ZoomHttpError } from './zoom-provider';
import { syncAppointment, prepareAppointmentChange, publicAppointment, assertAppointmentTaskAccess, type Appointment } from './appointment-lifecycle';
import { zoomJoinUrl } from './zoom-appointments';

vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn().mockResolvedValue({ active: true }) }));
vi.mock('./automation-settings', () => ({ getAgencyTimeZone: vi.fn().mockResolvedValue('America/Phoenix') }));
vi.mock('./zoom-provider', async (original) => ({ ...await original<typeof import('./zoom-provider')>(), ownZoomConnection: vi.fn(), zoomAuthorizedRequest: vi.fn() }));
vi.mock('./google-calendar', async (original) => ({ ...await original<typeof import('./google-calendar')>(), calendarRequest: vi.fn(), calendarBusy: vi.fn() }));
const actor = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002';
let db: SupabaseClient, event: Appointment, remote: Record<string, unknown> | null, ambiguous: boolean, rejected: boolean;
let calls: Array<{ path: string; method: string; body: Record<string, unknown> | null }>;
let patches: Record<string, unknown>[];
beforeEach(() => {
  vi.clearAllMocks(); remote = null; ambiguous = false; rejected = false; calls = []; patches = [];
  event = {
    id, user_id: actor, subject: 'Quote review', description: 'Private notes never sent to Zoom', event_date: '2030-01-15', event_time: '10:00',
    all_day: false, status: 'scheduled', related_type: null, related_id: null, client_id: null,
    meeting_type: 'zoom', duration_minutes: 45, location: null, calendar_sync: false,
    google_event_id: null, google_event_url: null, google_meet_url: null, sync_status: 'pending', sync_error: null,
    revision: 0, time_zone: 'America/Phoenix', updated_at: '2030-01-01T00:00:00Z',
    zoom_meeting_id: null, zoom_join_url: null, zoom_subject: 'zoom-owner', zoom_create_attempted_at: null,
  };
  db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/claim_appointment_sync')) return Response.json(event);
      if (url.pathname.endsWith('/events')) {
        if (init?.method === 'PATCH') {
          const patch = JSON.parse(String(init.body)) as Partial<Appointment>;
          patches.push(patch); event = { ...event, ...patch };
        }
        return Response.json(url.searchParams.get('select') === 'id' ? { id } : event);
      }
      return Response.json(null);
    },
  } });
  vi.mocked(ownZoomConnection).mockResolvedValue({ user_id: actor, email: 'qa@example.invalid', status: 'connected', last_error: null });
  vi.mocked(calendarBusy).mockResolvedValue([]);
  vi.mocked(zoomAuthorizedRequest).mockResolvedValue(async (path, init) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    calls.push({ path, method, body });
    if (method === 'POST') {
      expect(event.zoom_create_attempted_at).toBeTruthy();
      if (rejected) throw new ZoomHttpError(429);
      remote = { id: 12345678901, ...body, join_url: 'https://us02web.zoom.us/j/12345678901?pwd=synthetic', start_url: 'secret-host-url' };
      if (ambiguous) throw new Error('timeout after creation');
      return remote;
    }
    if (path.startsWith('/users/me/meetings?')) return { meetings: remote ? [remote] : [] };
    if (method === 'GET') { if (!remote) throw new ZoomHttpError(404); return remote; }
    if (method === 'DELETE') { remote = null; return null; }
    remote = { ...remote, ...body }; return null;
  });
});
it('creates a unique Zoom meeting using agency time and only exposes the attendee link', async () => {
  const saved = await syncAppointment(db, actor, id);
  expect(saved).toMatchObject({ sync_status: 'synced', zoom_meeting_id: '12345678901', zoom_join_url: 'https://us02web.zoom.us/j/12345678901?pwd=synthetic' });
  expect(calls[0]?.body).toMatchObject({ start_time: '2030-01-15T17:00:00.000Z', duration: 45, agenda: `[CRM appointment ${id}]`, settings: { use_pmi: false, waiting_room: true, join_before_host: false } });
  expect(JSON.stringify(calls)).not.toContain('Private notes');
  expect(JSON.stringify(saved)).not.toContain('secret-host-url');
  expect(calendarRequest).not.toHaveBeenCalled();
  expect(publicAppointment(saved)).not.toHaveProperty('zoom_meeting_id');
  expect(publicAppointment(saved)).not.toHaveProperty('zoom_subject');
  expect(publicAppointment(saved)).not.toHaveProperty('zoom_create_attempted_at');
});
it('reschedules the same Zoom meeting and cancels it without recreating or contacting Google', async () => {
  await syncAppointment(db, actor, id);
  event = { ...event, event_time: '11:00', revision: 1, sync_status: 'pending' };
  expect((await syncAppointment(db, actor, id)).zoom_meeting_id).toBe('12345678901');
  expect(calls.find((call) => call.method === 'PATCH')?.body?.start_time).toBe('2030-01-15T18:00:00.000Z');
  event = { ...event, status: 'cancelled', revision: 2, sync_status: 'pending' };
  expect(await syncAppointment(db, actor, id)).toMatchObject({ status: 'cancelled', sync_status: 'synced', zoom_join_url: null });
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  await syncAppointment(db, actor, id);
  expect(event.sync_status).toBe('synced');
  expect(calendarRequest).not.toHaveBeenCalled();
});
it('recovers a timed-out create by its durable marker instead of creating a second meeting', async () => {
  ambiguous = true;
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('failed');
  expect(event.zoom_meeting_id).toBeNull();
  expect(event.zoom_create_attempted_at).toBeTruthy();
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(calls.some((call) => call.path.includes('page_size=300'))).toBe(true);
});
it('never blindly recreates an uncertain missing meeting and allows retry after definitive rejection', async () => {
  event.zoom_create_attempted_at = '2030-01-01T00:00:00Z';
  expect((await syncAppointment(db, actor, id)).sync_error).toContain('no duplicate');
  expect(calls.some((call) => call.method === 'POST')).toBe(false);
  event.zoom_create_attempted_at = null; rejected = true;
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('failed');
  expect(event.zoom_create_attempted_at).toBeNull();
  rejected = false;
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
});
it('retains the Zoom identity through Google failures so retry never creates another meeting', async () => {
  event.calendar_sync = true; event.google_event_id = 'crm-google-id';
  vi.mocked(calendarRequest).mockRejectedValue(new Error('Google unavailable'));
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('failed');
  expect(event.zoom_meeting_id).toBe('12345678901');
  vi.mocked(calendarRequest).mockRejectedValueOnce(new CalendarHttpError(404)).mockResolvedValue({ htmlLink: 'https://calendar.google.com/event' });
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(vi.mocked(calendarRequest).mock.calls.some((call) => String(call[3]?.body).includes('https://us02web.zoom.us/j/12345678901'))).toBe(true);
});
it('removes Zoom when switching meeting type and does not recreate a meeting deleted outside CRM', async () => {
  await syncAppointment(db, actor, id); remote = null; event.sync_status = 'pending';
  expect((await syncAppointment(db, actor, id)).sync_error).toContain('deleted outside');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  event.meeting_type = 'phone';
  expect(await syncAppointment(db, actor, id)).toMatchObject({ sync_status: 'not_required', zoom_meeting_id: null, zoom_join_url: null });
});
it('allows explicit missing-meeting recovery only for the current revision after verifying Zoom again', async () => {
  event.zoom_create_attempted_at = '2030-01-01T00:00:00Z';
  expect((await syncAppointment(db, actor, id, { confirmedMissing: true, revision: 1 })).sync_status).toBe('failed');
  expect(calls).toHaveLength(0);
  expect((await syncAppointment(db, actor, id, { confirmedMissing: true, revision: 0 })).sync_status).toBe('synced');
  expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  expect(calls[0]?.path).toContain('/users/me/meetings?');
});
it('requires an active Zoom connection before saving a Zoom booking, rejects all day and guards task shortcuts', async () => {
  vi.mocked(ownZoomConnection).mockResolvedValue(null);
  await expect(prepareAppointmentChange(db, actor, id, { meeting_type: 'zoom' }, true)).rejects.toThrow('Connect your Zoom');
  await expect(prepareAppointmentChange(db, actor, id, { meeting_type: 'zoom', all_day: true }, true)).rejects.toThrow('timed appointment');
  await expect(assertAppointmentTaskAccess(db, actor, { event_id: id }, { status: 'completed' })).rejects.toThrow('Calendar');
});
it.each(['javascript:alert(1)', 'https://zoom.us.evil.invalid/j/12345678901', 'https://zoom.us/s/12345678901?zak=host', 'https://evil@zoom.us/j/12345678901'])('rejects unsafe or host links (%s)', (url) => {
  expect(zoomJoinUrl(url)).toBeNull();
});
