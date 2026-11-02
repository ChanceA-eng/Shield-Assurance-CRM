import { describe, expect, it } from 'vitest';
import { activeNavigationHref, navigationCategories } from '../config/navigation';

describe('release navigation', () => {
  it('has no duplicate or placeholder destinations', () => {
    const hrefs = navigationCategories.flatMap((category) => category.sections
      ? category.sections.flatMap((section) => section.items.map((item) => item.href)) : [category.href]);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).not.toContain('/billing');
    expect(hrefs).not.toContain('/commissions/statements');
    expect(hrefs).not.toContain('/carriers');
    expect(hrefs).not.toContain('/workday');
    expect(hrefs.filter((href) => href === '/tasks')).toHaveLength(1);
  });

  it('selects exactly the appropriate pipeline view and nested destination', () => {
    expect(activeNavigationHref('/leads', 'view=queue')).toBe('/leads?view=queue');
    expect(activeNavigationHref('/leads', 'view=list&lead=test')).toBe('/leads');
    expect(activeNavigationHref('/leads/import', '')).toBe('/leads/import');
    expect(activeNavigationHref('/clients/example', '')).toBe('/clients');
    expect(activeNavigationHref('/reports/leads', '')).toBe('/reports');
    expect(activeNavigationHref('/leadsmith', '')).toBeUndefined();
  });
});
