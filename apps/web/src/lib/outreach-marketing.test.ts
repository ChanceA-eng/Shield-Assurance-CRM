import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { DEFAULT_OUTREACH_SENDER, EMPTY_MARKETING_PROFILE, OUTREACH_TEMPLATES, isOutreachTemplate } from '@crm/shared';
import { buildGrounding, draftOutreach, draftSequenceStep, rewriteOutreach } from './outreach-ai';
import { outreachQualityIssues } from './outreach-quality';
import { getMarketingProfile, parseMarketingProfile, parseOutreachSender } from './marketing-profile';
import { recordOutreachContext } from './lead-outreach-context';
import { GET, PUT } from '../app/api/outreach/profile/route';
import { PATCH } from '../app/api/outreach/route';
import { getSupabaseServerClient } from './supabase-server';
import { getApiSession, requireApiSession } from './api-auth';
import { isRecord } from './workspace-validation';
import { appendAgencySignature, PERSONAL_SIGNATURE, SYSTEM_SIGNATURE } from './agency-signature';

vi.mock('./supabase-server', () => ({ getSupabaseServerClient: vi.fn() }));
vi.mock('./api-auth', () => ({ requireApiSession: vi.fn(), getApiSession: vi.fn() }));

const leadId = '168413e9-a6a4-4dff-a8bf-8f8df83dace6';
const clientId = '168413e9-a6a4-4dff-a8bf-8f8df83dace7';
const profile = {
  ...EMPTY_MARKETING_PROFILE, interests: 'Commercial auto', priorities: 'Keep the quote process simple',
  next_step: 'Request VIN by email', source: 'Customer call', confirmed_on: '2026-10-30',
  preferred_channel: 'email' as const, template: 'missing_information' as const,
};
const lead = { full_name: 'Leo', marketing_profile: profile, outreach_sender: DEFAULT_OUTREACH_SENDER };
const body = `Hi Leo,

Your commercial auto review has a clear constraint: keep the quote process simple. You asked to handle the next step by email, so I will keep the request to that one detail rather than ask you to repeat information already on file.

Could you reply with the VIN for the vehicle you want reviewed? Once I have it, I will confirm what is still needed before we discuss options. If you meant a different vehicle, tell me which one to focus on.

${'-- '}
Chance
Shield Assurance`;
const validDraft = { subject: 'Your commercial auto request', body, cited_signals: ['Stated insurance interests: Commercial auto'] };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const teamAccess: { mode: 'restricted'; grants: Record<string, unknown> } = { mode: 'restricted', grants: {
  'automation.manage': 'agency', 'leads.view': 'assigned', 'leads.edit': 'assigned',
  'accounts.view': 'assigned', 'accounts.edit': 'assigned',
} };

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.clearAllMocks();
  teamAccess.grants = {
    'automation.manage': 'agency', 'leads.view': 'assigned', 'leads.edit': 'assigned',
    'accounts.view': 'assigned', 'accounts.edit': 'assigned',
  };
  vi.mocked(requireApiSession).mockResolvedValue(null);
  vi.mocked(getApiSession).mockResolvedValue({
    user: { id: leadId, aud: 'authenticated', created_at: '2026-11-01T00:00:00Z', app_metadata: {}, user_metadata: {} },
    error: null, teamAccess,
  });
});

describe('contact and sender validation', () => {
  it('requires source and real confirmation dates for stated needs and contact preferences', () => {
    expect(parseMarketingProfile(profile)).toEqual(profile);
    expect(parseMarketingProfile(EMPTY_MARKETING_PROFILE)).toEqual(EMPTY_MARKETING_PROFILE);
    expect(() => parseMarketingProfile({ ...profile, source: '' })).toThrow('source');
    expect(() => parseMarketingProfile({ ...profile, confirmed_on: '2026-02-30' })).toThrow('date');
    expect(() => parseMarketingProfile({ ...profile, confirmed_on: '2999-01-01' })).toThrow('date');
    expect(() => parseMarketingProfile({ ...EMPTY_MARKETING_PROFILE, preferred_channel: 'sms' })).toThrow('source');
    expect(() => parseMarketingProfile({ ...profile, interests: 1 })).toThrow('interests');
    expect(() => parseMarketingProfile({ ...profile, interests: 'x'.repeat(1001) })).toThrow('1000');
    expect(() => parseMarketingProfile({ ...profile, template: 'spam' })).toThrow('template');
  });
  it('requires a sender identity and signature', () => {
    expect(parseOutreachSender(DEFAULT_OUTREACH_SENDER)).toEqual(DEFAULT_OUTREACH_SENDER);
    expect(() => parseOutreachSender({ ...DEFAULT_OUTREACH_SENDER, name: '' })).toThrow('required');
    expect(() => parseOutreachSender({ ...DEFAULT_OUTREACH_SENDER, signature: null })).toThrow('signature');
  });
  it('preserves authored producer signatures across immediate and scheduled delivery', () => {
    expect(appendAgencySignature(body)).toBe(`${body}\nhttps://www.shield-assurance.com`);
    const differentProducer = body.replace('Chance\nShield Assurance', 'Taylor\nShield Assurance');
    expect(appendAgencySignature(differentProducer)).toBe(`${differentProducer}\nhttps://www.shield-assurance.com`);
    expect(appendAgencySignature('Manually written unsigned email')).toContain(PERSONAL_SIGNATURE);
    expect(appendAgencySignature(body, 'system')).toContain(SYSTEM_SIGNATURE);
  });
  it('grounds stated needs and the latest conversation without treating preferences as consent', () => {
    const grounding = buildGrounding({ ...lead, recent_conversation: [{
      direction: 'inbound', sent_at: '2026-10-31T12:00:00Z', subject: 'VIN', body: 'Here is my VIN. Please email me.',
    }] });
    expect(grounding).toContain('Stated priorities: Keep the quote process simple');
    expect(grounding).toContain('Preferred channel (not consent to send): email');
    expect(grounding).toContain('Needs last confirmed on: 2026-10-30');
    expect(grounding).toContain('Here is my VIN. Please email me.');
  });
});

describe('deterministic quality checks', () => {
  it('accepts a concise draft and detects subject, placeholders, repetition and risky wording', () => {
    expect(outreachQualityIssues(validDraft)).toEqual([]);
    const issues = outreachQualityIssues({
      subject: 'repeat', body: `Hi [First name],\nWe guarantee coverage is bound. Save 25% today? Can we call?\n${body}`,
    }, [{ subject: 'Repeat', body: 'An earlier message.' }]);
    expect(issues).toContain('Replace unresolved template placeholders.');
    expect(issues).toContain('Use one clear question or next step.');
    expect(issues).toContain('Remove unverified savings, guarantees or assertions of bound coverage.');
    expect(issues).toContain('Use a different subject from previous emails.');
    expect(outreachQualityIssues({ subject: 'two\nlines', body: 'short' })).toContain('Use one nonempty subject line.');
    expect(outreachQualityIssues({ subject: 's', body: '' }).join(' ')).toContain('currently 0');
  });
  it('checks exact word thresholds and repeated openings after greetings', () => {
    const words = (count: number): string => Array.from({ length: count }, () => 'word').join(' ');
    expect(outreachQualityIssues({ subject: 's', body: words(35) })).toEqual([]);
    expect(outreachQualityIssues({ subject: 's', body: words(140) })).toEqual([]);
    expect(outreachQualityIssues({ subject: 's', body: words(34) }).join(' ')).toContain('currently 34');
    expect(outreachQualityIssues({ subject: 's', body: words(141) }).join(' ')).toContain('currently 141');
    expect(outreachQualityIssues({ subject: 'New', body: `Hi Leo,\nSame opening.\n${words(35)}` },
      [{ subject: 'Old', body: 'Hello Leo,\nSame opening.\nOld content.' }])).toContain('Use a different opening from previous emails.');
  });
  it('rejects generic copy and citations that are not actually used in the email', () => {
    const sloppy = {
      subject: 'Insurance options',
      body: 'Hello Rosella,\n\nThank you for reaching out regarding UNIVERSITY PLUMBING LLC. Given your focus in the construction industry, I can assist you with tailored coverage that suits your business needs. Please let me know if there are specific coverages you are interested in or if you would like to discuss your options further. Looking forward to your response.',
    };
    const issues = outreachQualityIssues(sloppy, [], { min: 35, max: 140 }, {
      email: true, specificSignals: ['Stated insurance interests: Commercial auto'],
      citedSignals: ['Stated insurance interests: Commercial auto'],
    });
    expect(issues).toContain('Remove generic sales copy. Open with the actual request or a specific profile detail, then explain the relevant next step.');
    expect(issues).toContain('Structure the email as a greeting, a short relevant explanation, and a separate next-step paragraph.');
    expect(issues).toContain('Use at least one specific profile detail in the email body, and cite that same detail. A name or broad industry alone is not specific.');
  });
  it('accepts a brief introduction followed by the cited detail, but not a buried detail', () => {
    const signal = 'Source-backed business detail: A fleet record lists 11 power units (reported 2026-11-05).';
    const context = { email: true, coldFirstTouch: true, specificSignals: [signal], citedSignals: [signal] };
    const grounded = {
      subject: 'A question about your fleet',
      body: `Hi Leo,\n\nI noticed the fleet record lists 11 power units. I can make the review easier to prepare.\n\nWould a short vehicle and driver checklist be useful?`,
    };
    const introductionFirst = {
      ...grounded,
      body: `Hi Leo,\n\nI'm Chance with Shield Assurance. I noticed your fleet record lists 11 power units.\n\nWould a short vehicle and driver checklist be useful?`,
    };
    const inlineGreeting = { ...grounded, body: `Hi Leo, it's Chance with Shield Assurance. I noticed your fleet record lists 11 power units.\n\nWould a checklist be useful?` };
    const buried = { ...grounded, body: `Hi Leo,\n\nI'm Chance with Shield Assurance. I'd like to introduce myself. Your fleet record lists 11 power units.\n\nWould a checklist be useful?` };
    expect(outreachQualityIssues(grounded, [], { min: 20, max: 120 }, context)).not.toContain(
      'For a cold first touch, mention a specific cited business detail near the beginning, after a brief introduction if needed.',
    );
    expect(outreachQualityIssues(introductionFirst, [], { min: 20, max: 120 }, context)).not.toContain(
      'For a cold first touch, mention a specific cited business detail near the beginning, after a brief introduction if needed.',
    );
    expect(outreachQualityIssues(inlineGreeting, [], { min: 10, max: 120 }, context)).not.toContain(
      'For a cold first touch, mention a specific cited business detail near the beginning, after a brief introduction if needed.',
    );
    expect(outreachQualityIssues(buried, [], { min: 20, max: 120 }, context)).toContain(
      'For a cold first touch, mention a specific cited business detail near the beginning, after a brief introduction if needed.',
    );
  });
  it.each(['Before I send a general insurance pitch', 'I can skip anything that is not useful', 'No documents or meeting are needed to reply'])('rejects unnecessary sales phrasing: %s', (phrase) => {
    const issues = outreachQualityIssues({ subject: 'A question', body: `Hi Leo,\n\n${phrase}.\n\nWould a checklist help?` });
    expect(issues).toContain('Remove generic sales copy. Open with the actual request or a specific profile detail, then explain the relevant next step.');
  });
});

describe('AI generation contract (mocked provider only)', () => {
  let requests: Array<{ messages: Array<{ role: string; content: string }> }>;
  let responses: unknown[];
  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real');
    requests = []; responses = [validDraft];
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as typeof requests[number]);
      return json({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] });
    }));
  });
  it.each(Object.keys(OUTREACH_TEMPLATES))('supports the %s purpose with sender and contact grounding', async (template) => {
    if (!isOutreachTemplate(template)) throw new Error('Missing template');
    const result = await draftOutreach(lead, undefined, template);
    expect(result).toEqual(validDraft);
    expect(requests[0].messages[0].content).toContain(OUTREACH_TEMPLATES[template].label);
    expect(requests[0].messages[0].content).toContain('supplied signature verbatim');
    expect(requests[0].messages[1].content).toContain('Request VIN by email');
  });
  it('rewrites edited drafts with instructions but keeps factual grounding and sender checks', async () => {
    responses = [{ ...validDraft, cited_signals: ['"Stated insurance interests: Commercial auto"'] }];
    expect(await rewriteOutreach(lead, { subject: 'Edited subject', body: 'My edited draft' }, 'Make it warmer', 2)).toEqual(validDraft);
    expect(requests[0].messages[1].content).toContain('My edited draft');
    expect(requests[0].messages[1].content).toContain('Make it warmer');
    expect(requests[0].messages[1].content).toContain('Stated insurance interests: Commercial auto');
    expect(requests[0].messages[0].content).toContain('sequence stage (2)');
    responses = [{ ...validDraft, cited_signals: ['"Invented fact"'] }, { ...validDraft, cited_signals: ['"Invented fact"'] }];
    await expect(rewriteOutreach(lead, validDraft, 'Add a guarantee', 2)).rejects.toMatchObject({ status: 422 });
  });
  it('repairs invalid types and rejects invented citations without returning success-shaped output', async () => {
    responses = [{ ...validDraft, body: { text: body } }, validDraft];
    expect(await draftOutreach(lead)).toEqual(validDraft);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[1].content).toContain('did not pass quality checks');
    responses = [{ ...validDraft, cited_signals: ['Invented fleet of 900 trucks'] }, validDraft];
    expect(await draftOutreach(lead)).toEqual(validDraft);
    expect(requests[3].messages[1].content).toContain('Copy each citation exactly from a contiguous excerpt');
  });
  it('resolves grounding IDs to original facts without requiring the model to copy their text', async () => {
    responses = [{ subject: validDraft.subject, body: validDraft.body, cited_signal_ids: ['G2', 'G2'] }];
    const result = await draftOutreach(lead);
    expect(result).toEqual(validDraft);
    expect(requests).toHaveLength(1);
    expect(requests[0].messages[0].content).toContain('cited_signal_ids');
    expect(requests[0].messages[1].content).toContain(JSON.stringify({ id: 'G2', excerpt: 'Stated insurance interests: Commercial auto' }));
  });
  it('repairs an invented grounding ID and never substitutes an unrelated citation', async () => {
    responses = [
      { subject: validDraft.subject, body: validDraft.body, cited_signal_ids: ['G999999'] },
      { subject: validDraft.subject, body: validDraft.body, cited_signal_ids: ['G2'] },
    ];
    expect(await draftOutreach(lead)).toEqual(validDraft);
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[1].content).toContain('only IDs from the Grounding data JSON references');
  });
  it('rejects unknown IDs even when the response also supplies a valid legacy citation', async () => {
    const invalid = { ...validDraft, cited_signal_ids: ['G999999'] };
    responses = [invalid, invalid];
    await expect(rewriteOutreach(lead, validDraft, 'Use a warmer tone', 1)).rejects.toMatchObject({ status: 422 });
    expect(requests).toHaveLength(2);
  });
  it('resolves grounding IDs for SMS and sequence drafts with the same public citation shape', async () => {
    responses = [{ subject: 'Your auto review', body: 'Could you email the VIN for the commercial auto review?', cited_signal_ids: ['G2'] }];
    expect(await draftOutreach({ ...lead, channel: 'sms' })).toEqual({
      subject: 'Your auto review', body: 'Could you email the VIN for the commercial auto review?',
      cited_signals: validDraft.cited_signals,
    });
    responses = [{ subject: validDraft.subject, body: validDraft.body, cited_signal_ids: ['G2'] }];
    expect(await draftSequenceStep(lead, 1, 3, [])).toEqual(validDraft);
  });
  it('attaches the exact saved signature instead of relying on the model to reproduce it', async () => {
    responses = [{ ...validDraft, body: body.replace('Chance\nShield Assurance', 'Someone else') }];
    expect(await draftOutreach(lead)).toEqual(validDraft);
    expect(requests).toHaveLength(1);
  });
  it('surfaces persistent quality failure without padding a short message', async () => {
    responses = [{ ...validDraft, body: 'Too short.' }, { subject: 's', body: 'short', cited_signals: [] }];
    await expect(draftOutreach(lead)).rejects.toMatchObject({ status: 422 });
    expect(requests).toHaveLength(2);
    expect(requests[1].messages[1].content).toContain('Do not add filler');
  });
  it('avoids sequence repetition and follows the preferred next step instead of always asking for calls', async () => {
    const prior = [{ subject: validDraft.subject, body: 'A prior opening.' }];
    responses = [validDraft, { ...validDraft, subject: 'A detail for your vehicle review' }];
    const draft = await draftSequenceStep(lead, 2, 3, prior);
    expect(draft?.subject).toBe('A detail for your vehicle review');
    expect(requests[0].messages[0].content).toContain('preferred channel');
    expect(requests[0].messages[1].content).toContain('A prior opening.');
    expect(requests[1].messages[1].content).toContain('different subject');
  });
  it('keeps final messages within the narrower final-step word range', async () => {
    const finalBody = `Hi Leo,\n\nYou mentioned commercial auto and preferred email. I will stop this sequence here rather than keep sending reminders.\n\nIf reviewing the vehicle is still useful, reply with the VIN whenever you are ready. I will confirm the next step by email.\n\n-- \nChance\nShield Assurance`;
    responses = [{ ...validDraft, body: finalBody }];
    expect(await draftSequenceStep(lead, 3, 3, [])).toMatchObject({ body: finalBody });
    expect(requests[0].messages[0].content).toContain('FINAL email');
  });
  it('uses the SMS-specific output range and does not call the provider without configuration', async () => {
    responses = [{ ...validDraft, body: 'Hi Leo, could you email the VIN for your commercial auto request?\nChance\nShield Assurance' }];
    expect(await draftOutreach({ ...lead, channel: 'sms' })).not.toBeNull();
    expect(requests[0].messages[0].content).toContain('10-60 words');
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(draftOutreach(lead)).rejects.toMatchObject({ status: 503 });
    expect(requests).toHaveLength(1);
  });
  it('honors the saved cold-first-touch purpose without padding a concise fact-led email', async () => {
    const signal = 'A fleet record lists 11 power units.';
    const coldBody = `Hi Leo,\n\nI'm Chance with Shield Assurance. I noticed your fleet record lists 11 power units.\n\nWould a short vehicle and driver checklist be useful?\n\n-- \nChance\nShield Assurance`;
    const coldDraft = { subject: 'Your 11-unit fleet review', body: coldBody, cited_signals: [`Source-backed business detail: ${signal}`] };
    responses = [{ ...coldDraft, body: coldBody.replace('I noticed your fleet record', 'I wanted to say hello. I noticed your fleet record') }, coldDraft];
    const result = await draftOutreach({ ...lead, marketing_profile: { ...profile, template: 'cold_prospecting' }, prospecting_signals: [signal] });
    expect(result?.body).toBe(coldBody);
    expect(requests).toHaveLength(2);
    expect(requests[0].messages[0].content).toContain('briefly introduce the agent and agency');
    expect(requests[1].messages[1].content).toContain('mention a specific cited business detail near the beginning');
  });
});

describe('profile, settings and canonical context persistence APIs', () => {
  interface Call { url: URL; method: string; body: Record<string, unknown> | null }
  let calls: Call[];
  let savedProfile: unknown;
  let sender: unknown;
  let linked: boolean;
  let failContext: boolean;
  let assignedTo: string;
  beforeEach(() => {
    calls = []; savedProfile = profile; sender = DEFAULT_OUTREACH_SENDER; linked = false; failContext = false; assignedTo = leadId;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const call: Call = { url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null };
      calls.push(call);
      if (url.pathname.endsWith('/agency_members')) return json({ user_id: leadId, role: 'owner', active: true });
      if (url.pathname.endsWith('/rpc/save_agency_outreach_settings')) {
        const update = call.body?.p_update;
        if (isRecord(update)) sender = update.sender_profile ?? sender;
        return json(null);
      }
      if (url.pathname.endsWith('/leads')) {
        return url.searchParams.has('account_id') ? json([{ id: leadId }]) : json({ id: leadId, full_name: 'Leo',
          account_id: linked ? clientId : null, agent_user_id: assignedTo });
      }
      if (url.pathname.endsWith('/clients')) return json({ id: clientId, full_name: 'Leo', agent_user_id: assignedTo });
      if (url.pathname.endsWith('/outreach_settings')) {
        if (call.method === 'PATCH') { sender = call.body?.sender_profile ?? sender; return json({ id: 1 }); }
        return json({ sender_profile: sender, daily_send_cap: 20 });
      }
      if (url.pathname.endsWith('/outreach_marketing_profiles')) {
        if (call.method === 'POST') { savedProfile = call.body?.profile; return new Response(null, { status: 201 }); }
        return json([{ client_id: linked ? clientId : null, profile: savedProfile }]);
      }
      if (url.pathname.endsWith('/canonical_communications')) return failContext ? json({ message: 'context unavailable', code: 'XX000' }, 500) : json([{
        direction: 'inbound', subject: 'VIN', body: 'VIN already supplied', sent_at: '2026-10-31T12:00:00Z',
      }]);
      return json([]);
    };
    vi.mocked(getSupabaseServerClient).mockReturnValue(createClient('https://example.supabase.co', 'test-key', {
      global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false },
    }));
  });
  const request = (method: string, value?: unknown): NextRequest => new NextRequest(`http://localhost/api/outreach/profile?record_type=lead&record_id=${leadId}`, {
    method, ...(value === undefined ? {} : { body: JSON.stringify({ profile: value }) }),
  });
  it('persists and reloads a profile without contacting AI or delivery providers', async () => {
    const updated = { ...profile, priorities: 'Email only' };
    expect((await PUT(request('PUT', updated))).status).toBe(200);
    expect(await (await GET(request('GET'))).json()).toEqual({ profile: updated });
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ lead_id: leadId, profile: updated });
    expect(calls.every((call) => call.url.hostname === 'example.supabase.co')).toBe(true);
  });
  it('requires explicit record permission and prevents assigned members from reading another member’s profile', async () => {
    teamAccess.grants = {};
    expect((await GET(request('GET'))).status).toBe(403);
    expect(calls).toHaveLength(0);
    teamAccess.grants = { 'leads.view': 'assigned' };
    assignedTo = 'another-agent';
    expect((await GET(request('GET'))).status).toBe(404);
    expect(calls).toHaveLength(1);
  });
  it('writes to the linked account and reads canonical account history', async () => {
    linked = true;
    expect((await PUT(request('PUT', profile))).status).toBe(200);
    expect(calls.find((call) => call.method === 'POST')?.body).toMatchObject({ client_id: clientId });
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new Error('Missing test database');
    const context = await recordOutreachContext(supabase, { type: 'lead', id: leadId });
    expect(context.marketing_profile).toEqual(profile);
    expect(context.outreach_sender).toEqual(DEFAULT_OUTREACH_SENDER);
    expect(context.recent_conversation[0].body).toBe('VIN already supplied');
    expect(calls.find((call) => call.url.pathname.endsWith('/canonical_communications'))?.url.searchParams.get('conversation_key')).toBe(`eq.client:${clientId}`);
    failContext = true;
    await expect(recordOutreachContext(supabase, { type: 'client', id: clientId })).rejects.toThrow('Something went wrong');
  });
  it('makes a linked lead profile available from the account before an account profile exists', async () => {
    const supabase = getSupabaseServerClient();
    if (!supabase) throw new Error('Missing test database');
    expect(await getMarketingProfile(supabase, { type: 'client', id: clientId })).toEqual(profile);
    expect(calls.find((call) => call.url.pathname.endsWith('/outreach_marketing_profiles'))?.url.searchParams.get('or')).toContain(`lead_id.eq.${leadId}`);
  });
  it('rejects invalid profiles, malformed bodies and unauthenticated writes', async () => {
    expect((await PUT(request('PUT', { ...profile, source: '' }))).status).toBe(400);
    expect((await PUT(new NextRequest(`http://localhost/api/outreach/profile?record_type=lead&record_id=${leadId}`, { method: 'PUT', body: '{' }))).status).toBe(400);
    vi.mocked(getApiSession).mockResolvedValue({ user: null, error: new NextResponse(null, { status: 401 }) });
    expect((await PUT(request('PUT', profile))).status).toBe(401);
    expect(calls).toHaveLength(0);
  });
  it('persists sender preferences and rejects invalid windows', async () => {
    const updated = { ...DEFAULT_OUTREACH_SENDER, name: 'Taylor', signature: 'Taylor\nShield Assurance' };
    const settingsRequest = (value: unknown): NextRequest => new NextRequest('http://localhost/api/outreach', { method: 'PATCH', body: JSON.stringify(value) });
    expect((await PATCH(settingsRequest({ sender_profile: updated }))).status).toBe(200);
    expect(sender).toEqual(updated);
    expect((await PATCH(settingsRequest({ send_window_start: 20, send_window_end: 8 }))).status).toBe(400);
    expect((await PATCH(settingsRequest({ daily_send_cap: 201 }))).status).toBe(400);
    expect((await PATCH(settingsRequest({ timezone: 'Mars/Phobos' }))).status).toBe(400);
    expect((await PATCH(settingsRequest({ timezone: 'America/Los_Angeles' }))).status).toBe(200);
  });
});
