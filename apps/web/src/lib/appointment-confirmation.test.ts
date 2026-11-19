import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { conversationAppointments, type SavedAppointment } from './appointment-confirmation';
import { POST } from '../app/api/events/[eventId]/confirmation/route';
import { getApiSession } from './api-auth';
import { getSupabaseServerClient } from './supabase-server';
import { salesFacts, listSalesTemplates } from './sales-templates';
import { getAgencyTimeZone } from './automation-settings';
import { resolveOutboundEmailRecipient } from './message-delivery';
import { sendAgentEmail } from './agent-email';
import { SALES_TEMPLATES } from '@crm/shared';
import { WorkspaceError } from './record-scope';
import { sealGmailSecret } from './gmail-provider';
import { appointmentAttemptId } from './appointment-notifications';

vi.mock('./api-auth', () => ({ getApiSession: vi.fn() }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./sales-templates', async (original) => ({ ...await original<typeof import('./sales-templates')>(), salesFacts: vi.fn(), listSalesTemplates: vi.fn() }));
vi.mock('./automation-settings', () => ({ getAgencyTimeZone: vi.fn() }));
vi.mock('./message-delivery', () => ({ resolveOutboundEmailRecipient: vi.fn() }));
vi.mock('./agent-email', () => ({ sendAgentEmail: vi.fn() }));
vi.mock('./agency-membership', () => ({ activeAgencyMember: vi.fn().mockResolvedValue({ active: true, role: 'owner' }) }));
const actor = '10000000-0000-4000-8000-000000000001', id = '10000000-0000-4000-8000-000000000002', lead = '10000000-0000-4000-8000-000000000003';
let rows: SavedAppointment[], attempt: unknown, urls: URL[];
const request = () => new NextRequest(`http://localhost/api/events/${id}/confirmation`, { method: 'POST', body: JSON.stringify({ confirmed: true, conversation: `lead:${lead}` }), headers: { 'Content-Type': 'application/json' } });
const context = { params: Promise.resolve({ eventId: id }) };
beforeEach(() => {
  vi.clearAllMocks(); attempt = null; urls = [];
  vi.stubEnv('GMAIL_OAUTH_REDIRECT_URI', 'https://crm.example.com/api/gmail/callback');
  vi.stubEnv('GMAIL_TOKEN_KEY_VERSION', 'v1');
  vi.stubEnv('GMAIL_TOKEN_KEYS', JSON.stringify({ v1: Buffer.alloc(32, 1).toString('base64') }));
  rows = [{ id, subject: 'Quote review', event_date: '2030-01-15', event_time: '10:30', all_day: false, related_type: 'lead', related_id: lead, client_id: null, status: 'scheduled',
    meeting_type: 'phone', duration_minutes: 30, sync_status: 'not_required', time_zone: 'America/Phoenix',
    ...{ user_id: actor, revision: 0 },
  }];
  const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
    fetch: async (input) => {
      const url = new URL(String(input)); urls.push(url);
      if (url.pathname.endsWith('/events')) return Response.json(rows);
      if (url.pathname.endsWith('/appointment_manage_tokens')) return Response.json({ token_secret: sealGmailSecret('x'.repeat(43), actor), expires_at: '2040-01-01T00:00:00Z' });
      if (url.pathname.endsWith('/agent_email_attempts')) return Response.json(attempt);
      return Response.json(null);
    },
  } });
  vi.mocked(getSupabaseServerClient).mockReturnValue(db);
  vi.mocked(getApiSession).mockResolvedValue({ user: { id: actor }, error: null } as Awaited<ReturnType<typeof getApiSession>>);
  vi.mocked(salesFacts).mockResolvedValue({ contact_name: 'QA', agent_name: 'Agent', agency_name: 'Shield Assurance' });
  vi.mocked(listSalesTemplates).mockResolvedValue([...SALES_TEMPLATES]);
  vi.mocked(getAgencyTimeZone).mockResolvedValue('America/Phoenix');
  vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({ ok: true, recipient: { to: 'qa@example.invalid', clientId: null, leadId: lead } });
  vi.mocked(sendAgentEmail).mockResolvedValue({ id: 'receipt', status: 'accepted_by_provider', provider: 'gmail' });
});
describe('saved appointment confirmations', () => {
  it('includes the Zoom attendee link in Gmail confirmation but never sends before Zoom is ready', async () => {
    rows[0] = { ...rows[0]!, meeting_type: 'zoom', zoom_join_url: 'https://zoom.us/j/12345678901?pwd=synthetic', sync_status: 'synced' };
    expect((await POST(request(), context)).status).toBe(200);
    expect(vi.mocked(sendAgentEmail).mock.calls[0]![2].body).toContain('Join: https://zoom.us/j/12345678901?pwd=synthetic');
    vi.mocked(sendAgentEmail).mockClear();
    rows[0] = { ...rows[0]!, zoom_join_url: null, sync_status: 'failed' };
    expect((await POST(request(), context)).status).toBe(409);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('does not claim a Zoom cancellation was notified before remote cancellation succeeds', async () => {
    rows[0] = { ...rows[0]!, meeting_type: 'zoom', status: 'cancelled', sync_status: 'failed' };
    expect((await POST(request(), context)).status).toBe(409);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('includes meeting details, duration, agency timezone, and opaque management links', async () => {
    rows[0] = { ...rows[0]!, meeting_type: 'google_meet', google_meet_url: 'https://meet.google.com/abc-defg-hij', sync_status: 'synced', duration_minutes: 45 };
    expect((await POST(request(), context)).status).toBe(200);
    const body = vi.mocked(sendAgentEmail).mock.calls[0]![2].body;
    expect(body).toContain('https://meet.google.com/abc-defg-hij');
    expect(body).toContain('Duration: 45 minutes');
    expect(body).toContain('America/Phoenix');
    expect(body).toContain('https://crm.example.com/appointments/manage/');
    expect(body).toContain('?action=cancel');
    expect(body).toContain('?action=reschedule');
  });
  it.each(['pending', 'failed'])('never sends an incomplete Meet confirmation (%s)', async (sync_status) => {
    rows[0] = { ...rows[0]!, meeting_type: 'google_meet', google_meet_url: null, sync_status };
    expect((await POST(request(), context)).status).toBe(409);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('infers cancellation and update notifications with distinct revision-based stable identities', async () => {
    rows[0] = { ...rows[0]!, ...{ revision: 1 } };
    expect((await POST(request(), context)).status).toBe(200);
    const updateId = vi.mocked(sendAgentEmail).mock.calls[0]![3].attemptId;
    expect(updateId).toBe(appointmentAttemptId({ id, revision: 1 }, 'rescheduled'));
    expect(updateId).not.toBe(id);
    rows[0] = { ...rows[0]!, status: 'cancelled', ...{ revision: 2 } };
    expect((await POST(request(), context)).status).toBe(200);
    const cancel = vi.mocked(sendAgentEmail).mock.calls[1]!;
    expect(cancel[2].subject).toBe('Appointment cancelled');
    expect(cancel[3].attemptId).toBe(appointmentAttemptId({ id, revision: 2 }, 'cancelled'));
    expect(cancel[3].attemptId).not.toBe(updateId);
  });
  it('uses saved event details, own Gmail and a durable event-based send identity', async () => {
    expect((await POST(request(), context)).status).toBe(200);
    expect(sendAgentEmail).toHaveBeenCalledWith(expect.anything(), actor, expect.objectContaining({
      to: 'qa@example.invalid', subject: 'Our appointment', body: expect.stringContaining('Quote review'),
    }), expect.objectContaining({ attemptId: id, leadId: lead, salesTemplate: { id: 'appointment_confirmation', revision: 0 } }));
    expect(urls[0]!.searchParams.get('user_id')).toBe(`eq.${actor}`);
    expect(urls[0]!.searchParams.get('id')).toBe(`eq.${id}`);
  });
  it('does not send to an opted-out or declined recipient', async () => {
    vi.mocked(resolveOutboundEmailRecipient).mockResolvedValue({ ok: false, status: 403, code: 'opted_out', message: 'This address unsubscribed.' });
    expect((await POST(request(), context)).status).toBe(403);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('does not send when the appointment belongs to a different contact or is no longer scheduled', async () => {
    rows = [];
    expect((await POST(request(), context)).status).toBe(404);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('does not send with an archived appointment template', async () => {
    vi.mocked(listSalesTemplates).mockResolvedValue(SALES_TEMPLATES.map((template) => ({ ...template, archived: template.id === 'appointment_confirmation' })));
    expect((await POST(request(), context)).status).toBe(409);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('surfaces disconnected Gmail without rebooking or using a shared mailbox fallback', async () => {
    vi.mocked(sendAgentEmail).mockRejectedValue(new WorkspaceError('Connect your own Gmail mailbox before sending.', 409));
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: 'Connect your own Gmail mailbox before sending.' });
    expect(urls.some((url) => url.pathname.includes('save_calendar_event'))).toBe(false);
  });
  it('does not retry an uncertain confirmation automatically', async () => {
    attempt = { user_id: actor, status: 'acceptance_unknown', communication_id: null };
    vi.mocked(sendAgentEmail).mockRejectedValue(new WorkspaceError('Check Gmail Sent. Do not resend.', 409));
    const response = await POST(request(), context);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ message: 'Check Gmail Sent. Do not resend.' });
    expect(sendAgentEmail).toHaveBeenCalledTimes(1);
  });
  it('requires contact permissions before listing calendar events', async () => {
    vi.mocked(salesFacts).mockRejectedValue(new Error('Contact unavailable'));
    await expect(conversationAppointments(getSupabaseServerClient()!, actor, `lead:${lead}`)).rejects.toThrow('Contact unavailable');
    expect(urls).toHaveLength(0);
  });
  it('returns the original receipt without a second Gmail send for a recorded confirmation', async () => {
    attempt = { user_id: actor, status: 'recorded', communication_id: 'original' };
    const response = await POST(request(), context);
    expect(await response.json()).toMatchObject({ id: 'original' });
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('never reuses another agent’s confirmation attempt', async () => {
    attempt = { user_id: 'other', status: 'recorded', communication_id: 'original' };
    expect((await POST(request(), context)).status).toBe(409);
    expect(sendAgentEmail).not.toHaveBeenCalled();
  });
  it('pages every scheduled appointment in chronological order', async () => {
    rows = Array.from({ length: 200 }, () => rows[0]!);
    const db = createClient('https://example.supabase.co', 'test-key', { auth: { persistSession: false }, global: {
      fetch: async (input) => { const url = new URL(String(input)); urls.push(url); return Response.json(url.searchParams.get('offset') === '0' ? rows : []); },
    } });
    expect((await conversationAppointments(db, actor, `lead:${lead}`)).appointments).toHaveLength(200);
    expect(urls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '200']);
  });
});
