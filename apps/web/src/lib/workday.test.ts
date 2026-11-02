import { describe, expect, it } from 'vitest';
import { workdayFilters } from './workday';

describe('workday filters', () => {
  it('uses explicit team-wide defaults and validates query-based paging', () => {
    expect(workdayFilters(new URLSearchParams())).toEqual({ page: 0, kind: 'all', timing: 'all', assignee: '' });
    expect(workdayFilters(new URLSearchParams('page=12&kind=reply&timing=overdue&assignee=unassigned'))).toEqual({ page: 12, kind: 'reply', timing: 'overdue', assignee: 'unassigned' });
  });
  it.each(['page=-1', 'page=1.5', 'page=1e2', 'kind=bogus', 'timing=bogus', `assignee=${'x'.repeat(121)}`])('rejects invalid filters %s', (query) => {
    expect(() => workdayFilters(new URLSearchParams(query))).toThrow();
  });
});
