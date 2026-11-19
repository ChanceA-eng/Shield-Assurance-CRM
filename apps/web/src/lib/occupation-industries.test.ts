import { describe, expect, it } from 'vitest';
import { OCCUPATIONS } from './applicant-details';
import { OCCUPATION_INDUSTRIES, occupationIndustry, occupationsForIndustry } from './occupation-industries';

describe('industry occupation lists', () => {
  it('assigns every catalog occupation to exactly one dropdown and sorts occupations alphabetically', () => {
    const grouped = OCCUPATION_INDUSTRIES.flatMap((industry) => {
      const options = occupationsForIndustry(industry.code);
      expect(options.every((row) => occupationIndustry(row.code) === industry.code)).toBe(true);
      expect(options.map((row) => row.title)).toEqual(options.map((row) => row.title).sort((a, b) => a.localeCompare(b)));
      return options;
    });
    expect(grouped).toHaveLength(OCCUPATIONS.length);
    expect(new Set(grouped.map((row) => row.code)).size).toBe(OCCUPATIONS.length);
    expect(occupationsForIndustry('29').some((row) => row.code === '29-1141.00')).toBe(true);
    expect(occupationsForIndustry('47').some((row) => row.code === '29-1141.00')).toBe(false);
  });
});
