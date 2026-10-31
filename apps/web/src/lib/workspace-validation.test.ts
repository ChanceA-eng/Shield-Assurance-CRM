import { describe, expect, it } from 'vitest';
import { absoluteDateTime, isUuid, validateAsset } from './workspace-validation';
import { namedTaskSubject, recordFilter, taskFilter } from './record-scope';
import { websiteBusinessDetails } from './website-intake';
import { accountLifecycle } from './account-lifecycle';

describe('Workspace inputs', () => {
  it.each(['2026-02-30T10:00:00Z', '2026-10-31T24:00:00Z', '2026-10-31T10:61:00Z', '2026-10-31T10:00', '', null])('rejects invalid or timezone-free reminder time %s', (value) => {
    expect(absoluteDateTime(value)).toBeNull();
  });
  it('normalizes an Arizona reminder to the same UTC instant', () => {
    expect(absoluteDateTime('2026-10-31T09:30:00-07:00')).toBe('2026-10-31T16:30:00.000Z');
  });
  it('validates UUIDs before building scoped filters', () => {
    expect(isUuid('lead-id,client_id.not.is.null')).toBe(false);
    expect(isUuid('39b92088-424c-4044-b2bc-854de43b3a0c')).toBe(true);
  });
  it('allows incomplete assets without pretending missing information is verified', () => {
    expect(validateAsset({ title: 'Second truck', asset_type: 'vehicle', details: {}, source: 'client_reported' })).toMatchObject({
      title: 'Second truck', details: {}, source: 'client_reported',
    });
  });
  it('validates vehicle identifiers and normalizes them', () => {
    expect(validateAsset({ title: 'Truck', asset_type: 'vehicle', details: { vin: '1ftfw1e50jfa12345' }, source: 'client_reported' })).toMatchObject({
      details: { vin: '1FTFW1E50JFA12345' },
    });
    expect(typeof validateAsset({ title: 'Truck', asset_type: 'vehicle', details: { vin: 'bad-vin' }, source: 'client_reported' })).toBe('string');
  });
  it('preserves valid pre-1981 identifiers', () => {
    expect(validateAsset({ title: 'Classic car', asset_type: 'vehicle', details: { year: '1970', vin: '12345ABC' }, source: 'client_reported' })).toMatchObject({
      details: { year: '1970', vin: '12345ABC' },
    });
  });
  it('rejects hidden fields from the wrong asset type', () => {
    expect(typeof validateAsset({ title: 'House', asset_type: 'property', details: { vin: '123' }, source: 'client_reported' })).toBe('string');
  });
  it('requires provenance when manually recording external-source data', () => {
    expect(typeof validateAsset({ title: 'Truck', asset_type: 'vehicle', details: {}, source: 'government' })).toBe('string');
    expect(validateAsset({ title: 'Truck', asset_type: 'vehicle', details: {}, source: 'government', source_reference: 'FMCSA record 123' })).toMatchObject({
      source_reference: 'FMCSA record 123',
    });
  });
  it('keeps task wording personal without duplicating a name already present', () => {
    expect(namedTaskSubject('Leo', 'Request VINs')).toBe('Leo: Request VINs');
    expect(namedTaskSubject('Leo', 'Call Leo about truck VINs')).toBe('Call Leo about truck VINs');
    expect(namedTaskSubject('A', 'Call for documents')).toBe('A: Call for documents');
  });
  it('includes account work in the linked lead without changing its original relation', () => {
    const scope = { target: { type: 'lead' as const, id: 'lead-uuid' }, leadId: 'lead-uuid', clientId: 'account-uuid', name: 'Leo' };
    expect(recordFilter(scope)).toBe('lead_id.eq.lead-uuid,client_id.eq.account-uuid');
    expect(taskFilter(scope)).toContain('account_id.eq.account-uuid');
    expect(taskFilter(scope)).toContain('and(related_type.eq.lead,related_id.eq.lead-uuid)');
  });
});

describe('Account identity and insurance lifecycle', () => {
  const now = new Date('2026-10-31T09:00:00Z');
  it('does not classify an account or won lead as insured without a placed policy', () => {
    expect(accountLifecycle([], now)).toBe('Prospect');
    expect(accountLifecycle([{ status: 'quoted' }], now)).toBe('Prospect');
  });
  it('uses policy dates, not just the existence of a policy row', () => {
    expect(accountLifecycle([{ status: 'active', effective_date: '2026-01-01', expiration_date: '2026-12-31' }], now)).toBe('Active client');
    expect(accountLifecycle([{ status: 'issued', effective_date: '2026-11-01', expiration_date: '2027-11-01' }], now)).toBe('Client - policy scheduled');
    expect(accountLifecycle([{ status: 'active', effective_date: '2025-01-01', expiration_date: '2026-01-01' }], now)).toBe('Former client');
    expect(accountLifecycle([{ status: 'active' }], now)).toBe('Client - verify policy status');
  });
  it('separates actual industry from commercial/personal insurance line', () => {
    expect(websiteBusinessDetails({ metadata: { businessName: 'Example Shop', businessReview: { industry: 'retail' } } })).toEqual({
      businessName: 'Example Shop', industry: 'retail',
    });
    expect(websiteBusinessDetails({ metadata: { businessReview: { industry: 'Commercial' } } }).industry).toBeNull();
  });
});
