import { beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calendarBusy, calendarRequest, CalendarHttpError } from './google-calendar';
import { ownedAppointment, prepareAppointmentChange, syncAppointment, publicAppointment, type Appointment } from './appointment-lifecycle';
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn().mockResolvedValue({ active: true }) }));
vi.mock('./automation-settings', () => ({ getAgencyTimeZone: vi.fn().mockResolvedValue('America/Phoenix') }));
vi.mock('./google-calendar', async (original) => ({ ...await original<typeof import('./google-calendar')>(), calendarRequest: vi.fn(), calendarBusy: vi.fn() }));
const actor = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002';
let event: Appointment, remote: Record<string, unknown> | null, db: SupabaseClient;
let providerCalls: Array<{ method: string; path: string; body: Record<string, unknown> | null }>;
let urls: URL[];
beforeEach(() => {
  vi.clearAllMocks(); providerCalls = []; urls = []; remote = null;
  event = {
    id, user_id: actor, subject: 'Appointment', description: 'Private agency notes', event_date: '2030-01-15', event_time: '10:00',
    all_day: false, status: 'scheduled', related_type: null, related_id: null, client_id: null, meeting_type: 'google_meet',
    duration_minutes: 30, location: null, calendar_sync: false, google_event_id: `crm${id.replace(/-/g, '')}r0`,
    google_event_url: null, google_meet_url: null, sync_status: 'pending', sync_error: null, revision: 0,
    time_zone: 'America/Phoenix', updated_at: '2030-01-01T00:00:00Z',
  };
  db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input)); urls.push(url);
      if (url.pathname.endsWith('/claim_appointment_sync')) return Response.json(event);
      if (url.pathname.endsWith('/events')) {
        if (url.searchParams.get('user_id') !== `eq.${actor}`) return Response.json(null);
        if (init?.method === 'PATCH') event = { ...event, ...JSON.parse(String(init.body)) as Partial<Appointment> };
        return Response.json(event);
      }
      return Response.json(null);
    },
  } });
  vi.mocked(calendarBusy).mockResolvedValue([]);
  vi.mocked(calendarRequest).mockImplementation(async (_db, _actor, path, init) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    providerCalls.push({ method, path, body });
    if (method === 'GET') { if (!remote) throw new CalendarHttpError(404); return remote; }
    if (method === 'DELETE') { remote = null; return null; }
    remote = { ...remote, ...body, htmlLink: 'https://calendar.google.com/calendar/event?eid=synthetic', hangoutLink: 'https://meet.google.com/abc-defg-hij' };
    return remote;
  });
});
it('creates an event/conference once with a durable identity and no provider attendee emails', async () => {
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
  expect(providerCalls.filter((call) => call.method === 'POST')).toHaveLength(1);
  const first = providerCalls.find((call) => call.method === 'POST')!;
  expect(first.body).toMatchObject({ id: event.google_event_id, start: { dateTime: '2030-01-15T17:00:00.000Z' }, end: { dateTime: '2030-01-15T17:30:00.000Z' } });
  expect(first.body).not.toHaveProperty('attendees');
  expect(first.path).toContain('sendUpdates=none');
  expect((await syncAppointment(db, actor, id)).google_meet_url).toBe('https://meet.google.com/abc-defg-hij');
  expect(providerCalls.filter((call) => call.method === 'POST')).toHaveLength(1);
});
it('persists async Meet pending and polls the same provider event without creating another conference', async () => {
  vi.mocked(calendarRequest).mockImplementationOnce(async () => { throw new CalendarHttpError(404); })
    .mockImplementationOnce(async (_db, _actor, _path, init) => {
      remote = { ...JSON.parse(String(init?.body)) as Record<string, unknown>, conferenceData: { createRequest: { status: { statusCode: 'pending' } } } };
      return remote;
    });
  const pending = await syncAppointment(db, actor, id);
  expect(pending).toMatchObject({ sync_status: 'pending', google_meet_url: null });
  expect(pending.sync_error).toContain('preparing');
  remote = { ...remote, hangoutLink: 'https://meet.google.com/abc-defg-hij' };
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
  expect(calendarRequest).toHaveBeenCalledTimes(3);
});
it('recovers a timed-out create by GET of the same durable ID instead of another insert', async () => {
  vi.mocked(calendarRequest).mockImplementationOnce(async () => { throw new CalendarHttpError(404); })
    .mockImplementationOnce(async (_db, _actor, _path, init) => {
      remote = { ...JSON.parse(String(init?.body)) as Record<string, unknown>, hangoutLink: 'https://meet.google.com/abc-defg-hij' };
      throw new Error('timeout after provider accepted');
    });
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('failed');
  expect(event.sync_error).toContain('saved');
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
  expect(calendarRequest).toHaveBeenCalledTimes(3);
});
it('reschedules the same event while preserving its existing Meet conference', async () => {
  await syncAppointment(db, actor, id);
  event = { ...event, revision: 1, event_time: '11:00', sync_status: 'pending' };
  const updated = await syncAppointment(db, actor, id);
  expect(updated.google_meet_url).toBe('https://meet.google.com/abc-defg-hij');
  expect(providerCalls.filter((call) => call.method === 'POST')).toHaveLength(1);
  const patch = providerCalls.find((call) => call.method === 'PATCH')!;
  expect(patch.body).not.toHaveProperty('conferenceData');
  expect(patch.body).toMatchObject({ start: { dateTime: '2030-01-15T18:00:00.000Z' } });
});
it('cancels remotely idempotently and retains the local cancelled event identity', async () => {
  await syncAppointment(db, actor, id);
  event = { ...event, status: 'cancelled', revision: 1, sync_status: 'pending' };
  expect((await syncAppointment(db, actor, id))).toMatchObject({ status: 'cancelled', sync_status: 'synced', google_meet_url: null });
  expect((await syncAppointment(db, actor, id)).status).toBe('cancelled');
  expect(providerCalls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  expect(event.google_event_id).not.toBeNull();
});
it('does not require or contact Google for manual phone appointments', async () => {
  event = { ...event, meeting_type: 'phone', sync_status: 'not_required' };
  await prepareAppointmentChange(db, actor, id, { subject: 'Phone' }, true);
  await syncAppointment(db, actor, id);
  expect(calendarRequest).not.toHaveBeenCalled();
  expect(calendarBusy).not.toHaveBeenCalled();
});
it('rejects Calendar conflicts before persistence and persists conflicts discovered during provider retry', async () => {
  vi.mocked(calendarBusy).mockResolvedValue([{ start: '2030-01-15T17:00:00Z', end: '2030-01-15T17:30:00Z' }]);
  await expect(prepareAppointmentChange(db, actor, id, event as unknown as Record<string, unknown>, true)).rejects.toMatchObject({ status: 409 });
  expect(urls).toHaveLength(0);
  expect((await syncAppointment(db, actor, id))).toMatchObject({ sync_status: 'failed', sync_error: expect.stringContaining('conflicts') });
  expect(providerCalls.some((call) => call.method === 'POST')).toBe(false);
});
it('enforces owner-scoped reads and excludes sensitive notes from public appointment facts', async () => {
  await expect(ownedAppointment(db, 'other-owner', id)).rejects.toMatchObject({ status: 404 });
  const facts = publicAppointment(event);
  expect(facts).not.toHaveProperty('user_id');
  expect(facts).not.toHaveProperty('description');
  expect(facts).not.toHaveProperty('related_id');
  expect(facts).not.toHaveProperty('google_event_id');
});
it('retries an explicitly failed conference using a new deterministic request identity', async () => {
  remote = {
    extendedProperties: { private: { crmRevision: '0' } },
    conferenceData: { createRequest: { requestId: 'failed-request', status: { statusCode: 'failure' } } },
  };
  expect((await syncAppointment(db, actor, id)).sync_status).toBe('synced');
  const patch = providerCalls.find((call) => call.method === 'PATCH');
  expect(patch?.body?.conferenceData).toMatchObject({ createRequest: { requestId: expect.not.stringMatching(/^failed-request$/) } });
});
