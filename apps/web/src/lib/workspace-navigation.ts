import { navigationCategories } from '../config/navigation';

const routeLabels: Record<string, string> = {
  '/': 'Dashboard', '/account': 'My Account', '/settings': 'Settings',
  '/learning': 'Training', '/learning/course-builder': 'Course Builder',
  '/rashi': 'Knowledge Center', '/rashi/knowledge': 'Knowledge Library',
  '/rashi/policy-review': 'Policy Review', '/policies/acord': 'ACORD Forms',
  '/policies/rewrites': 'Policy Rewrites', '/policies/transactions': 'Policy History',
  '/support': 'Support', '/security': 'Security',
};
for (const category of navigationCategories) {
  if (category.href) routeLabels[category.href] = category.label;
  for (const section of category.sections ?? []) {
    for (const item of section.items) {
      if (!item.href.includes('?')) routeLabels[item.href] = item.label;
    }
  }
}

export function isWorkspacePath(pathname: string): boolean {
  pathname = pathname.split(/[?#]/, 1)[0];
  return pathname.startsWith('/') && !pathname.startsWith('//')
    && !/[\\\u0000-\u0020]/.test(pathname)
    && !/^\/(?:login(?:\/|$)|auth(?:\/|$)|api(?:\/|$)|_next(?:\/|$)|secure-intake(?:\/|$)|appointments\/manage(?:\/|$)|intelligence\/questionnaire(?:\/|$))/.test(pathname);
}

export function navigationBreadcrumbs(pathname: string): Array<{ href: string; label: string }> {
  const labels = { ...routeLabels };
  const module = pathname.match(/^\/learning\/module\/(1[01]|[1-9])(?:\/|$)/);
  if (module) labels[module[0].replace(/\/$/, '')] = `Module ${module[1]}`;
  const builder = pathname.match(/^\/learning\/course-builder\/([^/]+)(?:\/|$)/);
  if (builder) labels[`/learning/course-builder/${builder[1]}`] = 'Course';
  const ancestors = Object.entries(labels)
    .filter(([href]) => href === '/' || pathname === href || pathname.startsWith(`${href}/`))
    .sort(([a], [b]) => a.length - b.length)
    .map(([href, label]) => ({ href, label }));
  if (!ancestors.some((item) => item.href === pathname)) {
    const segment = pathname.split('/').filter(Boolean).at(-1) ?? '';
    const label = pathname.startsWith('/clients/') ? 'Account'
      : /\/learning\/course\/[^/]+\/overview$/.test(pathname) ? 'Course'
      : /\/lesson\/[^/]+$/.test(pathname) ? 'Lesson'
      : pathname.startsWith('/rashi/document/') ? 'Document'
      : /^[0-9a-f]{8}-/i.test(segment) ? 'Details'
      : segment.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    ancestors.push({ href: pathname, label });
  }
  return ancestors;
}

export function navigationFallback(pathname: string): string {
  if (/^\/learning\/module\/(1[01]|[1-9])$/.test(pathname)) return '/learning/course/contractor-insurance-fundamentals/overview';
  const breadcrumbs = navigationBreadcrumbs(pathname);
  return breadcrumbs.at(-2)?.href ?? '/';
}

export function shouldGuardLink(event: Pick<MouseEvent, 'button' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
  link: Pick<HTMLAnchorElement, 'href' | 'target' | 'download' | 'hasAttribute'>, currentHref: string): boolean {
  if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey
    || (link.target && link.target !== '_self') || link.hasAttribute('download')) return false;
  const current = new URL(currentHref), target = new URL(link.href, current);
  return /^https?:$/.test(target.protocol)
    && (target.origin !== current.origin || target.pathname !== current.pathname || target.search !== current.search);
}
