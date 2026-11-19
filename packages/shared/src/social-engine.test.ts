import { describe, expect, it } from 'vitest';
import { parseSocialEngineCommand, parseSocialQueueJob, SOCIAL_TIMEZONE } from './social-engine.js';
const id = '28b06a5e-4ca6-4b32-a185-7293b4bd4a2d';
describe('Social execution contracts', () => {
  it.each(['success','retry_once','permanent_failure','uncertain'])('pins scenario %s to an exact revision', (scenario) => {
    const value = { action: 'prepare', id, post_id: id, revision: 2, scenario };
    expect(parseSocialEngineCommand(value)).toEqual(value);
  });
  it('prepares an exact approved revision against one connected provider account', () => {
    const value = { action: 'prepare_publish', id, post_id: id, revision: 2, connection_id: id };
    expect(parseSocialEngineCommand(value)).toEqual(value);
  });
  it('requires a verified provider ID to resolve an uncertain live post', () => {
    const value = { action: 'resolve_publish', id, expected_version: 4, resolution: 'published', remote_id: '123_456' };
    expect(parseSocialEngineCommand(value)).toEqual(value);
    expect(parseSocialEngineCommand({ action: 'resolve_publish', id, expected_version: 4, resolution: 'not_published' }))
      .toEqual({ action: 'resolve_publish', id, expected_version: 4, resolution: 'not_published' });
    expect(() => parseSocialEngineCommand({ ...value, permalink: 'javascript:alert(1)' })).toThrow();
  });
  it.each(['approve','cancel','retry','confirm'])('requires a concurrency version for %s', (action) => {
    expect(parseSocialEngineCommand({ action, id, expected_version: 3 })).toEqual({ action, id, expected_version: 3 });
    expect(() => parseSocialEngineCommand({ action, id })).toThrow();
  });
  it('allows explicit pause and canonical UTC schedule', () => {
    expect(parseSocialEngineCommand({ action: 'pause', paused: false })).toEqual({ action: 'pause', paused: false });
    const value = { action: 'schedule', id, expected_version: 1, scheduled_at: '2026-11-06T20:15:00.001Z', timezone: SOCIAL_TIMEZONE };
    expect(parseSocialEngineCommand(value)).toEqual(value);
  });
  const invalidValues: unknown[] = [null, [], {}, { action: 'pause', paused: 'false' },
    { action: 'pause', paused: false, p_actor: id },
    { action: 'pause', paused: false, toString: 'untrusted' },
    { action: 'retry', id: 'wrong', expected_version: 1 },
    { action: 'retry', id, expected_version: null },
    { action: 'retry', id, expected_version: 1.5 },
    { action: 'retry', id, expected_version: 0 },
    { action: 'retry', id, expected_version: 2147483647 },
    { action: 'retry', id, expected_version: 1, destination: 'facebook' },
    { action: 'prepare', id, post_id: id, revision: 1, scenario: 'publish' },
    { action: 'prepare_publish', id, post_id: id, revision: 1, connection_id: 'wrong' },
    { action: 'schedule', id, expected_version: 1, scheduled_at: '2026-02-30T20:00:00Z', timezone: SOCIAL_TIMEZONE },
    { action: 'schedule', id, expected_version: 1, scheduled_at: '2026-11-06T13:00:00-07:00', timezone: SOCIAL_TIMEZONE },
    { action: 'schedule', id, expected_version: 1, scheduled_at: '2026-11-06T20:00:00Z', timezone: 'UTC' },
  ];
  it.each(invalidValues)('rejects invalid or untrusted fields %j', (value) => {
    expect(() => parseSocialEngineCommand(value)).toThrow();
  });
  it('accepts only minimal version-bound queue data, never content or credentials', () => {
    expect(parseSocialQueueJob({ id, version: 7 })).toEqual({ id, version: 7 });
    for (const value of [{ id, version: 7, caption: 'x' }, { id, expected_version: 7 }, { id, version: null }, null]) {
      expect(() => parseSocialQueueJob(value)).toThrow();
    }
  });
});
