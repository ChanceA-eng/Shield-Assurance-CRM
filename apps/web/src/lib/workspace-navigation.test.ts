import { describe, expect, it } from 'vitest';
import { isWorkspacePath, navigationBreadcrumbs, navigationFallback, shouldGuardLink } from './workspace-navigation';

describe('workspace return paths', () => {
  it('links only real ancestors rather than turning every URL segment into a page', () => {
    expect(navigationBreadcrumbs('/learning/course/synthetic/overview').map((item) => item.href))
      .toEqual(['/', '/learning', '/learning/course/synthetic/overview']);
    expect(navigationBreadcrumbs('/learning/module/1/lesson/2').map((item) => item.href))
      .toEqual(['/', '/learning', '/learning/module/1', '/learning/module/1/lesson/2']);
    expect(navigationBreadcrumbs('/rashi/document/synthetic').map((item) => item.href))
      .toEqual(['/', '/rashi', '/rashi/document/synthetic']);
    expect(navigationBreadcrumbs('/clients/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa').at(-1)?.label).toBe('Account');
  });

  it('has a safe parent for directly opened details, including course module exits', () => {
    expect(navigationFallback('/clients/synthetic')).toBe('/clients');
    expect(navigationFallback('/leads/import')).toBe('/leads');
    expect(navigationFallback('/learning/module/1/lesson/2')).toBe('/learning/module/1');
    expect(navigationFallback('/learning/module/1')).toBe('/learning/course/contractor-insurance-fundamentals/overview');
    expect(navigationFallback('/tasks')).toBe('/');
  });

  it('never restores authentication, public-token or non-workspace destinations', () => {
    for (const href of ['/login?next=/tasks', '/auth/confirm?code=private', '/api/clients',
      '/intelligence/questionnaire/private', '/secure-intake/private', '/appointments/manage/private', '//outside.invalid', '/\\outside.invalid']) {
      expect(isWorkspacePath(href)).toBe(false);
    }
    expect(isWorkspacePath('/leads?view=queue&lead=synthetic')).toBe(true);
  });

  it('warns on navigation that replaces the current document, not downloads, hashes or new tabs', () => {
    const event = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false };
    const link = { href: 'https://crm.local/tasks', target: '', download: '', hasAttribute: () => false };
    expect(shouldGuardLink(event, link, 'https://crm.local/leads?view=queue')).toBe(true);
    expect(shouldGuardLink(event, { ...link, href: 'https://crm.local/leads?view=queue#notes' }, 'https://crm.local/leads?view=queue')).toBe(false);
    expect(shouldGuardLink(event, { ...link, target: '_blank' }, 'https://crm.local/leads')).toBe(false);
    expect(shouldGuardLink(event, { ...link, hasAttribute: () => true }, 'https://crm.local/leads')).toBe(false);
    expect(shouldGuardLink({ ...event, ctrlKey: true }, link, 'https://crm.local/leads')).toBe(false);
  });
});
