import { describe, expect, it } from 'vitest';
import type { WorkspaceAsset, WorkspaceNote } from '@crm/shared';
import { buildGrounding } from './outreach-ai';

describe('Saved-work outreach grounding (no AI call)', () => {
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
});
