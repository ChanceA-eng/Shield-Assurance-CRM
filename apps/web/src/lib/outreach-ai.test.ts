import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceAsset, WorkspaceNote } from '@crm/shared';
import { DEFAULT_OUTREACH_SENDER } from '@crm/shared';
import { buildGrounding, draftOutreach, draftSequenceStep, generateTalkingPoints } from './outreach-ai';

describe('Saved-work outreach grounding (no AI call)', () => {
  it('excludes structured license identifiers, birth dates and private address history from drafting', () => {
    const text = buildGrounding({
      full_name: 'Synthetic Applicant',
      form_payload: { agent_intake: { version: 1, kind: 'personal', sections: [
        { title: 'Applicant', fields: [{ label: 'Occupation', value: 'Registered Nurses' }, { label: 'Date of birth', value: '1985-04-02' }] },
        { title: 'Driver 1: Synthetic Applicant', fields: [{ label: 'License number', value: 'QA-SECRET-LICENSE' }] },
        { title: 'Previous address 1', fields: [{ label: 'Address', value: 'PRIVATE OLD ADDRESS' }] },
      ] } },
      workspace_assets: [{ id: 'driver', title: 'Synthetic Applicant', asset_type: 'driver', metadata: { source: 'client_reported',
        details: { license_number: 'QA-SECRET-LICENSE', dob: '1985-04-02', license_expires: '2030-04-02',
          address: 'PRIVATE DRIVER ADDRESS', years_at_address: '2' } }, archived_at: null,
        client_id: null, lead_id: 'lead', value: null, created_at: '2026-01-01', updated_at: '2026-01-01', created_by: null, updated_by: null }],
    });
    expect(text).toContain('Registered Nurses');
    expect(text).not.toContain('QA-SECRET-LICENSE');
    expect(text).not.toContain('1985-04-02');
    expect(text).not.toContain('2030-04-02');
    expect(text).not.toContain('PRIVATE OLD ADDRESS');
    expect(text).not.toContain('PRIVATE DRIVER ADDRESS');
  });
  it('accepts a verbatim citation when only its whitespace differs from the grounding block', async () => {
    const body = `Hi Northside Delivery,

For Northside Delivery, which issue would make a review useful right now: a vehicle, a cargo requirement, or something else?

Reply with one priority and I will send only the information needed for that question. There is no need to schedule a call or decide on a change before you have a clear answer.`;
    expect(body.split(/\s+/).length).toBeGreaterThanOrEqual(20);
    const request = vi.fn().mockImplementation(() => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        subject: 'A question for Northside Delivery',
        body,
        cited_signals: ['Prospect: Northside\n  Delivery'],
      }) } }],
    }), { status: 200 }));
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', request);
    try {
      const result = await draftOutreach({
        full_name: 'Northside Delivery',
        outreach_sender: { ...DEFAULT_OUTREACH_SENDER, signature: '' },
      });
      expect(result?.cited_signals).toEqual(['Prospect: Northside Delivery']);
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('still rejects paraphrased citations after a correction retry', async () => {
    const request = vi.fn().mockImplementation(() => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        subject: 'A question for Northside Delivery',
        body: 'Following up on your business. I can help review the next step and gather information you may need before a useful conversation. Share any current priorities or changes, and I will tailor the follow-up accordingly. We can keep the discussion focused and move at a pace that works well for you.',
        cited_signals: ['The prospect owns a delivery business'],
      }) } }],
    }), { status: 200 }));
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', request);
    try {
      await expect(draftOutreach({
        full_name: 'Northside Delivery',
        outreach_sender: { ...DEFAULT_OUTREACH_SENDER, signature: '' },
      })).rejects.toThrow('Copy each citation exactly');
      expect(request).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('does not start another AI request after the background drafting budget is exhausted', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{}' } }],
    }), { status: 200 }));
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', request);
    const clock = vi.spyOn(Date, 'now').mockReturnValueOnce(10000).mockReturnValue(21001);
    try {
      await expect(draftSequenceStep({ full_name: 'Synthetic prospect' }, 1, 3, [], 21000)).rejects.toThrow('time budget');
      expect(request).toHaveBeenCalledTimes(1);
    } finally {
      clock.mockRestore(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
    }
  });
  it('uses call notes, actual industry and multiple assets without asserting insurance', () => {
    const asset: WorkspaceAsset = {
      id: 'asset', client_id: null, lead_id: 'lead', title: 'Delivery truck', asset_type: 'vehicle', value: null,
      metadata: { details: { make: 'Ford', year: '2022', use: 'Deliveries' }, source: 'client_reported' },
      archived_at: null, created_at: '2026-10-31T09:00:00Z', updated_at: '2026-10-31T09:00:00Z', created_by: null, updated_by: null,
    };
    const note: WorkspaceNote = {
      id: 'note', lead_id: 'lead', client_id: null, content: 'Ask for the VIN before requesting a quote.', note_type: 'call',
      pinned: true, author_name: 'Agent', updated_by: null, created_at: '2026-10-31T09:00:00Z', updated_at: '2026-10-31T09:00:00Z',
    };
    const text = buildGrounding({
      full_name: 'Leo', line_of_business: 'Commercial',
      form_payload: { metadata: { businessReview: { industry: 'retail' } } },
      workspace_assets: [asset, { ...asset, id: 'second', title: 'Second truck' }, { ...asset, id: 'archived', title: 'Old truck', archived_at: '2026-10-31T10:00:00Z' }],
      workspace_notes: [note],
    });
    expect(text).toContain('Actual business industry: retail');
    expect(text).toContain('Delivery truck');
    expect(text).toContain('Second truck');
    expect(text).not.toContain('Old truck');
    expect(text).toContain('coverage NOT confirmed');
    expect(text).toContain('Ask for the VIN before requesting a quote.');
    expect(text).toContain('Year: 2022');
  });
  it('uses opt-in dossier facts as dated, cited grounding without exposing the source reference', () => {
    const text = buildGrounding({
      full_name: 'Northside Delivery',
      confirmed_dossier_facts: [{
        field: 'stated_priorities',
        label: 'Prospect-stated priorities',
        value: 'Reliable certificate turnaround',
        source_as_of: '2026-11-02',
      }],
    });
    expect(text).toContain('Agent-confirmed dossier finding (Prospect-stated priorities; confirmed as of 2026-11-02): Reliable certificate turnaround');
    expect(text).not.toContain('reference');
  });
  it('lets current confirmed renewal facts supersede conflicting vendor predictions in opt-in AI grounding', () => {
    const text = buildGrounding({
      full_name: 'Northside Delivery',
      form_payload: { profile: {
        kind: 'commercial',
        renewals: [
          { type: 'General Liability', date: '2027-01-01', evidence_class: 'predicted', precision: 'month' },
          { type: 'Commercial Auto', date: '2027-02-01', evidence_class: 'predicted', precision: 'month' },
        ],
        liability: { gl_xdate: '2027-01-01', commercial_auto_xdate: '2027-04-01' },
      } },
      confirmed_dossier_facts: [
        { field: 'renewal_line', label: 'Confirmed renewal line', value: 'General Liability', source_as_of: '2026-11-02' },
        { field: 'renewal_date', label: 'Confirmed renewal date', value: '2027-02-15', source_as_of: '2026-11-02' },
      ],
    });
    expect(text).toContain('Agent-confirmed dossier finding (Confirmed renewal date; confirmed as of 2026-11-02): 2027-02-15');
    expect(text).not.toContain('General Liability: Predicted month: 2027-01');
    expect(text).not.toContain('General Liability predicted renewal month (unconfirmed): 2027-01');
    expect(text).toContain('Commercial Auto: Predicted month: 2027-02');
    expect(text).toContain('Commercial Auto predicted renewal month (unconfirmed): 2027-04');
    expect(text).toContain('supersedes conflicting unconfirmed reported timing for: General Liability');
  });
  it('accepts call prep only when citations quote exact supplied grounding facts', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        points: [
          'Ask whether Reliable certificate turnaround remains the priority.',
          'Discuss Reliable certificate turnaround as the recorded service need.',
          'Agree on a next step related to Reliable certificate turnaround.',
        ],
        cited_signals: ['Reliable certificate turnaround'],
      }) } }],
    }), { status: 200 }));
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', request);
    try {
      const result = await generateTalkingPoints({
        full_name: 'Northside Delivery',
        confirmed_dossier_facts: [{
          field: 'stated_priorities', label: 'Prospect-stated priorities',
          value: 'Reliable certificate turnaround', source_as_of: '2026-11-02',
        }],
      });
      expect(result?.cited_signals[0]).toBe('Reliable certificate turnaround');
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
  it('rejects call prep with fabricated or missing citations instead of returning an ungrounded result', async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        points: ['Point one.', 'Point two.', 'Point three.'],
        cited_signals: ['Prospect wants lower premiums'],
      }) } }],
    }), { status: 200 }));
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', request);
    try {
      await expect(generateTalkingPoints({ full_name: 'Synthetic prospect' })).resolves.toBeNull();
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
