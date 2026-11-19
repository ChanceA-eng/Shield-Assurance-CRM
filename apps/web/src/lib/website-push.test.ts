import { describe, expect, it } from 'vitest';
import { isAuthorizedWebsitePush, missingFieldUpdates } from './website-push';

describe('website pipeline push', () => {
  it('trusts a push only with the shared website token', () => {
    expect(isAuthorizedWebsitePush({ pipeline_push: true }, 'Bearer secret', 'secret')).toBe(true);
    expect(isAuthorizedWebsitePush({ pipeline_push: true }, 'Bearer wrong!', 'secret')).toBe(false);
    expect(isAuthorizedWebsitePush({ pipeline_push: true }, null, 'secret')).toBe(false);
    expect(isAuthorizedWebsitePush({}, 'Bearer secret', 'secret')).toBe(false);
    expect(isAuthorizedWebsitePush({ pipeline_push: true }, 'Bearer ', '')).toBe(false);
  });

  it('fills only empty card fields from the real submission', () => {
    const card = { zip: null, business: 'Typed by producer', details: '', line_of_business: 'General Request', bundles: [] };
    const payload = { zip: '85719', business: 'Website name', message: 'Real request', line_of_business: 'Commercial', bundles: ['Home'], state: '' };
    expect(missingFieldUpdates(card, payload)).toEqual({ zip: '85719', details: 'Real request', line_of_business: 'Commercial', bundles: ['Home'] });
    expect(missingFieldUpdates({ line_of_business: 'Auto' }, { line_of_business: 'Commercial' })).toEqual({});
    const dump = 'ID: 42\nCREATED_AT: 2026-06-30\nINTAKE_ROUTE: coverage-guide';
    expect(missingFieldUpdates({ details: dump }, { details: 'Real request' })).toEqual({ details: 'Real request' });
    expect(missingFieldUpdates({ details: 'Producer note' }, { details: 'Real request' })).toEqual({});
  });
});
