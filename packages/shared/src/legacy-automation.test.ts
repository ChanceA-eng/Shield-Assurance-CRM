import { describe, expect, it } from 'vitest';
import { isLegacyDealBoundAutomationEnabled } from './legacy-automation.js';

describe('legacy deal-bound automation policy', () => {
  it('is disabled unless explicitly enabled with the exact true value', () => {
    expect(isLegacyDealBoundAutomationEnabled(undefined)).toBe(false);
    expect(isLegacyDealBoundAutomationEnabled('')).toBe(false);
    expect(isLegacyDealBoundAutomationEnabled('TRUE')).toBe(false);
    expect(isLegacyDealBoundAutomationEnabled('true')).toBe(true);
  });
});
