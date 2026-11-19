import { describe, expect, it } from 'vitest';
import { parseSourcePublishedAt, RashiInputError } from './rashi-server';

describe('Rashi source publication dates', () => {
  it('accepts a real date-only value and leaves missing dates unrecorded', () => {
    expect(parseSourcePublishedAt('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(parseSourcePublishedAt('')).toBeNull();
    expect(parseSourcePublishedAt(undefined)).toBeNull();
  });

  it.each(['2024-02-30', '2024/02/29', '0999-01-01', 20240229])('rejects invalid date input %s', (value) => {
    expect(() => parseSourcePublishedAt(value)).toThrow(RashiInputError);
  });
});
