import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { SALES_TEMPLATES, SALES_FIELDS, SALES_CATEGORIES, renderSalesTemplate, salesTemplateErrors, SALES_SEQUENCE_PRESETS, DEFAULT_OUTREACH_SENDER, DEFAULT_EMAIL_DESIGN } from '@crm/shared';
import { GET, POST, PATCH } from '../app/api/sales-templates/route';
import { POST as enroll, PATCH as changeSequence } from '../app/api/sales-sequences/route';
import { getSupabaseServerClient } from './supabase-server';
import { parseSalesPlan, salesSequenceBlock } from './sales-sequences';
import { mergeSalesFacts, salesFacts, templateSnapshot } from './sales-templates';
import { draftOutreach } from './outreach-ai';
import { prepareEnrollmentDraft } from './outreach-engine';
import { requireMarketingConsent } from './marketing-email';
import { activeAgencyMember } from './agency-membership';
import { WorkspaceError } from './record-scope';
import { verifiedReplyCheck } from './email-setup';
import { getOwnGmailConnection } from './gmail-provider';

const actor = '168413e9-a6a4-4dff-a8bf-8f8df83dace6', leadId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
let role = 'owner', saved: Record<string, unknown> | null, revisionConflict = false;
let schemaError = false;
let stage = 'new', reply = false, overlap = false;
let enrollment: Record<string, unknown> | null, rpcCalls: Array<{ name: string; input: Record<string, unknown> }>;
const sender = { ...DEFAULT_OUTREACH_SENDER, name: 'Taylor', signature: 'Taylor\nTest Agency', agency: 'Test Agency' };
vi.mock('./api-auth', () => ({ getApiSession: vi.fn(async () => ({ user: { id: actor }, error: null })) }));
vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./agency-membership', () => ({
  activeAgencyMember: vi.fn(async () => ({ role, active: true })), agencyEnabled: () => false,
}));
vi.mock('./marketing-profile', async (importOriginal) => ({
  ...await importOriginal<typeof import('./marketing-profile')>(),
  getOutreachSender: vi.fn(async () => sender),
  getMarketingProfile: vi.fn(async () => ({ interests: 'Commercial auto', next_step: 'Review requirements', source: 'Customer call', confirmed_on: '2026-11-05' })),
}));
vi.mock('./outreach-ai', () => ({ draftOutreach: vi.fn() }));
vi.mock('./outreach-engine', () => ({ prepareEnrollmentDraft: vi.fn(async () => true) }));
vi.mock('./marketing-email', () => ({ requireMarketingConsent: vi.fn(async () => {}), marketingEnvelope: vi.fn(() => ({ body: '', headers: {} })) }));
vi.mock('./email-setup', () => ({ verifiedReplyCheck: vi.fn(async () => '2026-11-05T00:00:00Z') }));
vi.mock('./message-delivery', () => ({ resolveOutboundEmailRecipient: vi.fn(async () => ({ ok: true, recipient: { to: 'synthetic@example.test', leadId, clientId: null } })) }));
vi.mock('./gmail-provider', () => ({ getOwnGmailConnection: vi.fn(async () => null) }));
vi.mock('./lead-outreach-context', () => ({ recordOutreachContext: vi.fn(async () => ({ recent_conversation: [], outreach_sender: sender })) }));

beforeEach(() => {
  vi.clearAllMocks(); role = 'owner'; saved = null; enrollment = null; rpcCalls = []; stage = 'new'; reply = false; overlap = false; revisionConflict = false; schemaError = false;
  vi.mocked(getOwnGmailConnection).mockResolvedValue(null);
  vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://db.example.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      const path = new URL(String(url));
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
      if (path.pathname.endsWith(`/auth/v1/admin/users/${actor}`)) return json({ id: actor, user_metadata: {}, app_metadata: {}, aud: 'authenticated', created_at: '2026-01-01' });
      if (path.pathname.endsWith('/email_signature_designs')) return json(null);
      if (path.pathname.endsWith('/sales_templates')) return schemaError
        ? json({ code: '42703', message: 'column sales_templates.email_design does not exist' }, 400)
        : json(saved ? [saved] : []);
      if (path.pathname.includes('/rpc/')) {
        const name = path.pathname.split('/').at(-1) ?? '';
        rpcCalls.push({ name, input: body });
        if (name === 'save_sales_template') {
          if (revisionConflict) return json({ message: 'Conflict', code: 'PT409' }, 409);
          saved = { ...(body.p_values as Record<string, unknown>), revision: Number(body.p_expected) + 1 };
          return json(saved);
        }
        if (name === 'enroll_sales_sequence' || name === 'enroll_personal_gmail_sales_sequence') {
          enrollment = { id: leadId, lead_id: leadId, current_step: 0, total_steps: 2, sales_plan: body.p_plan };
          return json(enrollment);
        }
        return json(null);
      }
      if (path.pathname.endsWith('/leads')) return json({ id: leadId, full_name: 'Synthetic contact', agent_user_id: actor, email: 'synthetic@example.test',
        business: 'Synthetic Plumbing LLC', form_payload: { business_name: 'Synthetic Plumbing LLC' }, status: stage, archived_at: null, account_id: null });
      if (path.pathname.endsWith('/scheduled_messages')) return json(overlap ? [{ id: leadId }] : []);
      if (path.pathname.endsWith('/canonical_communications')) return json(reply ? [{ id: leadId, direction: 'inbound' }] : []);
      if (path.pathname.endsWith('/sequence_enrollments')) return json({ lead_id: leadId, sales_plan: enrollment?.sales_plan, enrolled_at: '2026-11-05' });
      if (path.pathname.endsWith('/events')) return json(null);
      if (path.pathname.endsWith('/quote_options')) return json(null);
      if (path.pathname.endsWith('/marketing_email_consents')) return json(null);
      return json({ message: 'Unexpected test query' }, 500);
    } },
  }));
});
afterEach(() => vi.unstubAllEnvs());
const request = (method: string, value?: unknown, query = '') => new NextRequest(`http://localhost/api/sales-templates${query}`, {
  method, ...(value ? { body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' } } : {}),
});

describe('sales catalog', () => {
  it('identifies the required migration instead of hiding a missing branding schema behind a generic error', async () => {
    schemaError = true;
    const response = await GET(request('GET'));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ message: expect.stringContaining('20261112010000_branded_email_templates') });
  });
  it('covers thirty-five sales moments and both channels with valid merge fields', () => {
    expect(SALES_TEMPLATES).toHaveLength(35);
    expect(new Set(SALES_TEMPLATES.map((template) => template.id)).size).toBe(35);
    const facts = Object.fromEntries(SALES_FIELDS.map((field) => [field, 'Verified detail']));
    for (const template of SALES_TEMPLATES) {
      expect(salesTemplateErrors(template)).toEqual([]);
      for (const channel of ['email', 'sms'] as const) {
        const rendered = renderSalesTemplate(template, channel, facts);
        expect(rendered.missing).toEqual([]);
        expect(rendered.body).not.toContain('{{');
      }
    }
    expect(SALES_CATEGORIES.every((category) => SALES_TEMPLATES.some((template) => template.category === category))).toBe(true);
  });
  it('provides six distinct touches for prospecting, post-appointment and post-quote review', () => {
    const families = [
      ['introduction', 'contact_second_followup', 'contact_third_followup', 'contact_fourth_followup', 'contact_fifth_followup', 'contact_sixth_followup'],
      ['meeting_recap', 'meeting_second_followup', 'meeting_third_followup', 'meeting_fourth_followup', 'meeting_fifth_followup', 'meeting_sixth_followup'],
      ['quote_first_followup', 'quote_second_followup', 'quote_third_followup', 'quote_fourth_followup', 'quote_fifth_followup', 'quote_sixth_followup'],
    ];
    for (const ids of families) {
      const templates = ids.map((id) => {
        const template = SALES_TEMPLATES.find((row) => row.id === id);
        expect(template, `${id} must be available in the shared library`).toBeDefined();
        return template!;
      });
      expect(new Set(templates.map((row) => row.subject)).size).toBe(6);
      expect(new Set(templates.map((row) => row.email_body.split('\n\n')[1])).size).toBe(6);
      for (const template of templates) {
        expect((template.email_body.match(/\?/g) ?? []).length, `${template.id}: one reply decision`).toBe(1);
        expect(template.email_body.split('\n\n').length, `${template.id}: readable short paragraphs`).toBeGreaterThanOrEqual(4);
        expect(template.email_body.trim().split(/\s+/).length).toBeLessThanOrEqual(140);
        expect(template.sms_body.length).toBeLessThanOrEqual(320);
        expect(template.email_body).not.toMatch(/just (?:checking in|following up)|guaranteed savings|last chance|act now/i);
      }
    }
    expect(SALES_SEQUENCE_PRESETS.initial_contact.templates).toEqual(['introduction', 'close_loop']);
    expect(SALES_SEQUENCE_PRESETS.post_appointment.templates).toHaveLength(3);
    expect(SALES_SEQUENCE_PRESETS.quote_followup.templates).toHaveLength(3);
  });
  it('requires confirmed interests and agreed next steps in later personalized touches', () => {
    for (const id of ['inquiry_response', 'introduction', 'contact_second_followup', 'contact_third_followup', 'contact_fourth_followup', 'contact_fifth_followup', 'contact_sixth_followup']) {
      const template = SALES_TEMPLATES.find((row) => row.id === id)!;
      expect(renderSalesTemplate(template, 'email', { contact_name: 'Test' }).missing).toContain('insurance_interest');
    }
    for (const id of ['meeting_third_followup', 'meeting_fourth_followup', 'meeting_fifth_followup', 'meeting_sixth_followup']) {
      const template = SALES_TEMPLATES.find((row) => row.id === id)!;
      expect(renderSalesTemplate(template, 'email', { contact_name: 'Test' }).missing).toContain('next_step');
    }
  });
  it('keeps cold prospecting separate and provides an evidence-led and question-first first touch', () => {
    const evidenced = SALES_TEMPLATES.find((row) => row.id === 'cold_first_touch_evidence')!;
    const fallback = SALES_TEMPLATES.find((row) => row.id === 'cold_first_touch_question')!;
    expect(evidenced.email_body).toContain('{{prospecting_signal}}');
    expect(evidenced.email_body).toContain('{{specific_offer}}');
    expect(evidenced.email_body.indexOf('{{agent_name}}')).toBeLessThan(evidenced.email_body.indexOf('{{prospecting_signal}}'));
    expect(fallback.email_body).not.toContain('{{prospecting_signal}}');
    expect((fallback.email_body.match(/\?/g) ?? []).length).toBe(1);
    for (const template of SALES_TEMPLATES.filter((row) => row.category === 'First contact')) {
      expect(template.email_body).not.toMatch(/\bpitch\b|no documents or meeting|skip anything that is not useful/i);
    }
    expect(SALES_TEMPLATES.find((row) => row.id === 'inquiry_response')?.email_body).toContain('your request');
  });
  it('never invents missing appointments, quote links or binding requirements', () => {
    for (const id of ['appointment_confirmation', 'quote_delivery', 'binding_next_steps']) {
      const template = SALES_TEMPLATES.find((row) => row.id === id)!;
      const rendered = renderSalesTemplate(template, 'email', { contact_name: 'Test' });
      expect(rendered.missing.length).toBeGreaterThan(0);
      expect(rendered.body).toContain('{{');
    }
  });
  it('rejects unknown/malformed fields, multiline subjects and sender overrides', () => {
    const template = SALES_TEMPLATES[0]!;
    expect(salesTemplateErrors({ ...template, email_body: '{{invented_price}}' }).join(' ')).toContain('Unknown field');
    expect(salesTemplateErrors({ ...template, email_body: '{broken}' })).not.toEqual([]);
    expect(salesTemplateErrors({ ...template, subject: 'Hello\nInjected' })).not.toEqual([]);
    expect(mergeSalesFacts({ agent_name: 'Taylor' }, { agent_name: 'Imposter', contact_name: 'Verified' })).toMatchObject({ agent_name: 'Taylor', contact_name: 'Verified' });
    expect(() => mergeSalesFacts({}, { quote_link: 'javascript:alert(1)' })).toThrow('HTTPS');
  });
});
describe('persistent template APIs', () => {
  it('saves and applies a branded template, rejecting altered or outdated design snapshots', async () => {
    const design = { ...DEFAULT_EMAIL_DESIGN, brand_name: 'Example agency', heading: 'Welcome',
      image_url: 'https://assets.example.invalid/banner.jpg', image_alt: 'Agency banner',
      image_link_url: 'https://example.invalid/quote',
      button_label: 'Get started', button_url: 'https://example.invalid/start' };
    const original = SALES_TEMPLATES.find((row) => row.id === 'introduction')!;
    const savedResponse = await PATCH(request('PATCH', { ...original, email_design: design }));
    expect(savedResponse.status).toBe(200);
    const response = await POST(request('POST', { id: original.id, revision: 1, channel: 'email',
      conversation: `lead:${leadId}`, facts: {}, confirmed: true }));
    expect(response.status).toBe(200);
    const draft = await response.json();
    expect(draft.template).toEqual({ id: original.id, revision: 1, email_design: design });
    const db = getSupabaseServerClient()!;
    expect(await templateSnapshot(db, draft.template)).toEqual(draft.template);
    await expect(templateSnapshot(db, { ...draft.template, email_design: { ...design, button_url: 'https://other.invalid' } })).rejects.toThrow('design changed');
    await expect(templateSnapshot(db, { ...draft.template, email_design: { ...design, image_link_url: 'https://other.invalid' } })).rejects.toThrow('design changed');
    await expect(templateSnapshot(db, { id: original.id, revision: 1 })).rejects.toThrow('design changed');
    expect((await PATCH(request('PATCH', { ...original, email_design: { ...design, button_url: 'javascript:evil()' } }))).status).toBe(400);
  });
  it('keeps saved agency wording instead of replacing it with refreshed starter copy', async () => {
    saved = { ...SALES_TEMPLATES.find((row) => row.id === 'introduction'), subject: 'Agency-approved subject',
      email_body: 'Agency-approved wording for {{contact_name}}.', revision: 3 };
    const response = await GET(request('GET'));
    const library = await response.json();
    expect(library.templates).toContainEqual(expect.objectContaining({ id: 'introduction', subject: 'Agency-approved subject',
      email_body: 'Agency-approved wording for {{contact_name}}.', revision: 3 }));
    expect(library.templates).toContainEqual(expect.objectContaining({ id: 'contact_sixth_followup', revision: 0 }));
    expect(rpcCalls).toEqual([]);
  });
  it('owner saves a CRM revision that appears in subsequent reads', async () => {
    const template = SALES_TEMPLATES[0]!;
    const response = await PATCH(request('PATCH', { ...template, email_body: 'Saved agency content for {{contact_name}}.' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 1 });
    const read = await GET(request('GET'));
    expect((await read.json()).templates).toContainEqual(expect.objectContaining({ id: template.id, revision: 1, email_body: 'Saved agency content for {{contact_name}}.' }));
    expect(rpcCalls[0]?.input.p_actor).toBe(actor);
  });
  it('agents can browse but cannot save, and admins can save', async () => {
    role = 'agent';
    expect((await GET(request('GET'))).status).toBe(200);
    expect((await PATCH(request('PATCH', SALES_TEMPLATES[0]))).status).toBe(403);
    expect(rpcCalls).toHaveLength(0);
    role = 'admin';
    expect((await PATCH(request('PATCH', SALES_TEMPLATES[0]))).status).toBe(200);
  });
  it('returns a visible conflict rather than overwriting simultaneous edits', async () => {
    revisionConflict = true;
    expect((await PATCH(request('PATCH', SALES_TEMPLATES[0]))).status).toBe(409);
  });
  it('renders deterministically without AI and keeps sender identity server-owned', async () => {
    const response = await POST(request('POST', { id: 'introduction', revision: 0, channel: 'email',
      conversation: `lead:${leadId}`, facts: { agent_name: 'Imposter' }, confirmed: true }));
    expect(response.status).toBe(200);
    const draft = await response.json();
    expect(draft.body).toContain('Taylor');
    expect(draft.body).not.toContain('Imposter');
    expect(draft.template).toEqual({ id: 'introduction', revision: 0 });
    expect(draftOutreach).not.toHaveBeenCalled();
  });
  it('prefills the saved business name and confirmed marketing interest for template drafts', async () => {
    const facts = await salesFacts(getSupabaseServerClient()!, actor, `lead:${leadId}`);
    expect(facts).toMatchObject({ business_name: 'Synthetic Plumbing LLC', insurance_interest: 'Commercial auto' });
  });
  it('blocks incomplete, stale and archived templates', async () => {
    expect((await POST(request('POST', { id: 'quote_delivery', revision: 0, channel: 'email', conversation: `lead:${leadId}`, facts: {}, confirmed: true }))).status).toBe(400);
    saved = { ...SALES_TEMPLATES[0], revision: 1, archived: true };
    expect((await POST(request('POST', { id: saved.id, revision: 0, channel: 'email', conversation: `lead:${leadId}`, facts: {}, confirmed: true }))).status).toBe(409);
    const db = getSupabaseServerClient()!;
    await expect(templateSnapshot(db, { id: saved.id, revision: 1 })).rejects.toThrow('archived');
  });
  it('preserves explicit AI privacy scope and rejects unmatched history personalization', async () => {
    const response = await POST(request('POST', { id: 'introduction', revision: 0, channel: 'email',
      conversation: 'unmatched:synthetic@example.test', facts: { contact_name: 'Synthetic', insurance_interest: 'Commercial auto' },
      personalize: true, confirmed: true }));
    expect(response.status).toBe(409);
    expect(draftOutreach).not.toHaveBeenCalled();
  });
  it('requires explicit factual confirmation before rendering or personalizing', async () => {
    const response = await POST(request('POST', { id: 'introduction', revision: 0, channel: 'email',
      conversation: `lead:${leadId}`, facts: {}, personalize: true }));
    expect(response.status).toBe(400);
    expect(draftOutreach).not.toHaveBeenCalled();
  });
  it('passes confirmed details and eligible context to optional AI without invoking a send', async () => {
    vi.mocked(draftOutreach).mockResolvedValueOnce({ subject: 'Reviewed next step', body: 'A grounded draft.', cited_signals: ['Confirmed next step'] });
    const response = await POST(request('POST', { id: 'meeting_recap', revision: 0, channel: 'email',
      conversation: `lead:${leadId}`, facts: { next_step: 'Review the vehicle list' }, personalize: true, confirmed: true }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ template: { id: 'meeting_recap', revision: 0 } });
    expect(draftOutreach).toHaveBeenCalledWith(expect.objectContaining({ outreach_sender: sender, recent_conversation: [],
      form_payload: expect.objectContaining({ profile: expect.objectContaining({ extras: expect.any(Object) }) }) }),
    expect.stringContaining('Review the vehicle list'), undefined);
    expect(rpcCalls.filter((call) => call.name !== 'get_record_business_research')).toEqual([]);
  });
});
describe('optional sales sequences', () => {
  const enrollInput = () => ({ lead_id: leadId, preset: 'initial_contact', gap: 5, facts: {}, confirmed: true });
  it('queues all explicitly reviewed steps through personal Gmail with multi-agent mode off', async () => {
    vi.mocked(getOwnGmailConnection).mockResolvedValue({ id: actor, user_id: actor, email: 'agent@example.test', status: 'connected',
      sync_enabled: false, last_sync_at: null, last_error: null, watch_expires_at: null, bootstrap_complete: false, history_id: null });
    const result = await enroll(request('POST', { ...enrollInput(), email_provider: 'gmail', auto_send: true }));
    expect(result.status).toBe(201);
    expect(rpcCalls).toContainEqual(expect.objectContaining({ name: 'enroll_personal_gmail_sales_sequence',
      input: expect.objectContaining({ p_plan: expect.objectContaining({ mailbox: actor, auto_send: true }) }) }));
    expect(parseSalesPlan(enrollment?.sales_plan).steps.every((step) => !step.requires_review)).toBe(true);
    expect(requireMarketingConsent).not.toHaveBeenCalled();
    expect(prepareEnrollmentDraft).toHaveBeenCalledTimes(1);
  });
  it('does not fall back to Resend when personal Gmail is unavailable or approval is missing', async () => {
    expect((await enroll(request('POST', { ...enrollInput(), email_provider: 'gmail', auto_send: true }))).status).toBe(409);
    expect((await enroll(request('POST', { ...enrollInput(), email_provider: 'gmail', auto_send: true, confirmed: false }))).status).toBe(400);
    expect((await enroll(request('POST', { ...enrollInput(), email_provider: 'resend', auto_send: true }))).status).toBe(400);
    expect(rpcCalls.filter((call) => call.name !== 'get_record_business_research')).toEqual([]);
    expect(prepareEnrollmentDraft).not.toHaveBeenCalled();
  });
  it('requires explicit enrollment and always starts approval-first regardless of global flag', async () => {
    expect((await enroll(request('POST', { ...enrollInput(), confirmed: false }))).status).toBe(400);
    expect((await enroll(request('POST', enrollInput()))).status).toBe(201);
    const plan = parseSalesPlan(enrollment?.sales_plan);
    expect(plan.auto_send).toBe(false);
    expect(plan.steps[0]?.requires_review).toBe(true);
    expect(plan.steps[0]?.template.revision).toBe(0);
    expect(prepareEnrollmentDraft).toHaveBeenCalledTimes(1);
    expect(Object.keys(SALES_SEQUENCE_PRESETS)).toHaveLength(3);
  });
  it('requires real appointment/quote evidence and rejects overlapping manual schedules', async () => {
    expect((await enroll(request('POST', { ...enrollInput(), preset: 'post_appointment' }))).status).toBe(400);
    expect((await enroll(request('POST', { ...enrollInput(), preset: 'quote_followup', evidence_id: leadId }))).status).toBe(409);
    overlap = true;
    expect((await enroll(request('POST', enrollInput()))).status).toBe(409);
    expect(prepareEnrollmentDraft).not.toHaveBeenCalled();
  });
  it('requires separate auto-send consent and rejects changed stage or replies', async () => {
    await enroll(request('POST', enrollInput()));
    expect((await changeSequence(request('PATCH', { id: leadId, action: 'enable_auto' }))).status).toBe(400);
    expect((await changeSequence(request('PATCH', { id: leadId, action: 'enable_auto', confirmed: true }))).status).toBe(200);
    expect(requireMarketingConsent).toHaveBeenCalledWith(expect.anything(), 'synthetic@example.test');
    const db = getSupabaseServerClient()!;
    stage = 'quoted';
    expect(await salesSequenceBlock(db, leadId, enrollment?.sales_plan)).toContain('stage');
    stage = 'new'; reply = true;
    expect(await salesSequenceBlock(db, leadId, enrollment?.sales_plan, '2026-11-05')).toContain('replied');
  });
  it('requires reapproval after a shared template changes', async () => {
    await enroll(request('POST', enrollInput()));
    saved = { ...SALES_TEMPLATES.find((row) => row.id === 'introduction'), revision: 1 };
    expect(await salesSequenceBlock(getSupabaseServerClient()!, leadId, enrollment?.sales_plan)).toContain('template changed');
    expect((await changeSequence(request('PATCH', { id: leadId, action: 'enable_auto', confirmed: true }))).status).toBe(409);
  });
  it('preserves sender approval when database JSON reorders object properties', async () => {
    await enroll(request('POST', enrollInput()));
    const plan = parseSalesPlan(enrollment?.sales_plan);
    const stored = { ...plan, sender: Object.fromEntries(Object.entries(plan.sender).reverse()) };
    expect(await salesSequenceBlock(getSupabaseServerClient()!, leadId, stored)).toBeNull();
  });
  it('refuses automatic sending until shared reply syncing is verified', async () => {
    await enroll(request('POST', enrollInput()));
    vi.stubEnv('RESEND_REPLY_SYNC_READY', 'false');
    vi.mocked(verifiedReplyCheck).mockResolvedValueOnce(null);
    const response = await changeSequence(request('PATCH', { id: leadId, action: 'enable_auto', confirmed: true }));
    expect(response.status).toBe(409);
    expect(rpcCalls.some((call) => call.name === 'set_sales_sequence_state')).toBe(false);
  });
  it('returns an actionable pause reason for a deactivated sequence owner', async () => {
    await enroll(request('POST', enrollInput()));
    vi.mocked(activeAgencyMember).mockRejectedValueOnce(new WorkspaceError('Membership required.', 403));
    expect(await salesSequenceBlock(getSupabaseServerClient()!, leadId, enrollment?.sales_plan)).toContain('no longer an active');
  });
});
