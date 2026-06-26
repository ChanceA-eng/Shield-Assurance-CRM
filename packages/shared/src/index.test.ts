import { describe, expect, it } from 'vitest';
import { WORKFLOW_EVENTS } from './index';

describe('shared contracts', () => {
  it('exposes workflow event names', () => {
    expect(WORKFLOW_EVENTS.DEAL_BOUND).toBe('deal.bound');
  });
});
