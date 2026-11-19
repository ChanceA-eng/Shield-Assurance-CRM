import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { managedAppointment, manageAppointment } from './appointment-management';
import { getSupabaseServerClient } from './supabase-server';
import { calendarBusy, ownCalendarConnection } from './google-calendar';
import { sendAppointmentNotification } from './appointment-notifications';
import { type Appointment } from './appointment-lifecycle';
import { GET, POST } from '../app/api/appointments/manage/[token]/route';
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn().mockResolvedValue({ active: true }) }));
vi.mock('./appointment-notifications', () => ({ sendAppointmentNotification: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./google-calendar', async (original) => ({ ...await original<typeof import('./google-calendar')>(), calendarBusy: vi.fn(), ownCalendarConnection: vi.fn() }));
const actor = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', token = 'x'.repeat(43);
let event: Appointment, db: SupabaseClient;
let calls: Array<{ url: URL; body: Record<string, unknown> | null }>;
let tokenValid: boolean;
beforeEach(() => {
  vi.clearAllMocks(); calls = []; tokenValid = true; vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  event = {
    id, user_id: actor, subject: 'Quote review', description: 'Private agency notes', event_date: '2030-01-15', event_time: '10:00',
    all_day: false, status: 'scheduled', related_type: 'lead', related_id: '10000000-0000-4000-8000-000000000003', client_id: null,
    meeting_type: 'phone', duration_minutes: 45, location: '555-555-5555', calendar_sync: false, google_event_id: null,
    google_event_url: null, google_meet_url: null, sync_status: 'not_required', sync_error: null, revision: 0,
    time_zone: 'America/Phoenix', updated_at: '2030-01-01T00:00:00Z',
  };
  db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input, init) => {
      const url = new URL(String(input)), body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      calls.push({ url, body });
      if (url.pathname.endsWith('/appointment_manage_tokens')) return Response.json(tokenValid ? { event_id: id } : null);
      if (url.pathname.endsWith('/events')) return Response.json(event);
      if (url.pathname.endsWith('/save_calendar_event')) {
        event = { ...event, ...body?.p_changes as Partial<Appointment>, revision: event.revision + 1 };
        return Response.json(event);
      }
      return Response.json(null);
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(ownCalendarConnection).mockResolvedValue(null);
  vi.mocked(calendarBusy).mockResolvedValue([]);
  vi.mocked(sendAppointmentNotification).mockResolvedValue({ id: 'receipt', kind: 'rescheduled', message: 'Sent' });
});
afterEach(() => { vi.useRealTimers(); });
const context = { params: Promise.resolve({ token }) };
const request = (body: unknown) => new NextRequest(`https://crm.example.invalid/api/appointments/manage/${token}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
it('reveals only limited facts to a valid unexpired token and never exposes contact or private notes', async () => {
  const response = await GET(new NextRequest(`https://crm.example.invalid/api/appointments/manage/${token}`), context);
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  const value = await response.json() as { appointment: Record<string, unknown>; allowed_durations: number[] };
  expect(value.allowed_durations).toEqual([45]);
  expect(value.appointment).not.toHaveProperty('related_id');
  expect(value.appointment).not.toHaveProperty('description');
  expect(value.appointment).not.toHaveProperty('user_id');
  expect(calls[0]?.url.searchParams.get('token_hash')).not.toContain(token);
  expect(calls[0]?.url.searchParams.get('expires_at')).toMatch(/^gt\./);
});
it('rejects invalid and expired or tampered tokens before accessing appointment facts', async () => {
  await expect(managedAppointment(db, 'bad')).rejects.toMatchObject({ status: 404 });
  expect(calls).toHaveLength(0);
  tokenValid = false;
  await expect(managedAppointment(db, token)).rejects.toMatchObject({ status: 404 });
  expect(calls).toHaveLength(1);
});
it.each([
  { action: 'reschedule', revision: 0, event_date: '2030-01-16', event_time: '11:00', duration_minutes: 90 },
  { action: 'reschedule', revision: 0, event_date: '2030-01-16', event_time: '11:00', related_id: id },
  { action: 'reschedule', revision: 0, event_date: '2030-01-16', event_time: '11:00', user_id: actor },
  { action: 'reschedule', revision: 0, event_date: '2030-01-16', event_time: '11:00', email: 'other@example.invalid' },
])('rejects contact, owner, or duration changes through the customer token', async (body) => {
  expect((await POST(request(body), context)).status).toBe(400);
  expect(calls.some((call) => call.url.pathname.endsWith('/save_calendar_event'))).toBe(false);
});
it('requires the current saved revision and a future time within the limited booking window', async () => {
  await expect(manageAppointment(db, event, { action: 'reschedule', revision: 1, event_date: '2030-01-16', event_time: '11:00' })).rejects.toMatchObject({ status: 409 });
  await expect(manageAppointment(db, event, { action: 'reschedule', revision: 0, event_date: '2029-01-16', event_time: '11:00' })).rejects.toMatchObject({ status: 400 });
  expect(calls).toHaveLength(0);
});
it('checks connected-calendar freebusy before a customer reschedule, including phone bookings', async () => {
  vi.mocked(ownCalendarConnection).mockResolvedValue({ user_id: actor, email: 'qa@example.invalid', status: 'connected', last_error: null });
  vi.mocked(calendarBusy).mockResolvedValue([{ start: '2030-01-16T18:00:00Z', end: '2030-01-16T18:45:00Z' }]);
  await expect(manageAppointment(db, event, { action: 'reschedule', revision: 0, event_date: '2030-01-16', event_time: '11:00' })).rejects.toMatchObject({ status: 409 });
  expect(calls.some((call) => call.url.pathname.endsWith('/save_calendar_event'))).toBe(false);
});
it('retains the booked fixed duration and persists reschedule even if its own Gmail notification fails', async () => {
  vi.mocked(sendAppointmentNotification).mockRejectedValue(new Error('Gmail unavailable'));
  const result = await manageAppointment(db, event, { action: 'reschedule', revision: 0, event_date: '2030-01-16', event_time: '11:00' });
  expect(result.event).toMatchObject({ event_date: '2030-01-16', event_time: '11:00', duration_minutes: 45 });
  expect(result.notification.status).toBe('failed');
  const save = calls.find((call) => call.url.pathname.endsWith('/save_calendar_event'))?.body;
  expect(save?.p_user).toBe(actor);
  expect(save?.p_changes).toEqual({ event_date: '2030-01-16', event_time: '11:00', expected_revision: 0 });
});
it('makes repeated customer cancellation a no-op without another send', async () => {
  const first = await manageAppointment(db, event, { action: 'cancel', revision: 0 });
  expect(first.event.status).toBe('cancelled');
  const second = await manageAppointment(db, first.event, { action: 'cancel', revision: 0 });
  expect(second.notification.status).toBe('not_requested');
  expect(sendAppointmentNotification).toHaveBeenCalledTimes(1);
  expect(calls.filter((call) => call.url.pathname.endsWith('/save_calendar_event'))).toHaveLength(1);
});
