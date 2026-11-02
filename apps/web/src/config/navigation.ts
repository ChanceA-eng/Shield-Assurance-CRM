/**
 * Centralized Navigation Registry
 * Single source of truth for the CoreUI-style sidebar navigation.
 * Groups render as expandable sections in AppSidebar.
 */

export interface NavItem {
  label: string;
  href: string;
  badge?: string | number;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export interface NavCategory {
  id: string;
  label: string;
  icon: string; // Lucide icon name
  href?: string; // Direct link when there are no sections
  sections?: NavSection[];
}

export const navigationCategories: NavCategory[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'CheckSquare',
    href: '/tasks',
  },
  {
    id: 'clients',
    label: 'Accounts',
    icon: 'Users',
    href: '/clients',
  },
  {
    id: 'leads',
    label: 'Leads',
    icon: 'Users',
    sections: [
      {
        title: 'Pipeline',
        items: [
          { label: 'Lead Pipeline', href: '/leads' },
          { label: 'Work Queue', href: '/leads?view=queue' },
          { label: 'Import Leads', href: '/leads/import' },
        ],
      },
    ],
  },
  {
    id: 'policy-mgmt',
    label: 'Policies',
    icon: 'FileStack',
    sections: [
      {
        title: 'Policies',
        items: [
          { label: 'All Policies', href: '/policies' },
          { label: 'Renewals', href: '/renewals' },
          { label: 'Claims', href: '/claims' },
          { label: 'Endorsements', href: '/endorsements' },
          { label: 'Certificates', href: '/certificates' },
        ],
      },
    ],
  },
  {
    id: 'communication',
    label: 'Communication',
    icon: 'Network',
    sections: [
      {
        title: 'Channels',
        items: [
          { label: 'Inbox', href: '/communication' },
          { label: 'Outreach Sequences', href: '/outreach' },
          { label: 'Calendar & Events', href: '/scheduler' },
        ],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'BarChart3',
    sections: [
      {
        title: 'Reports',
        items: [
          { label: 'All Reports', href: '/reports' },
        ],
      },
    ],
  },
  {
    id: 'knowledge',
    label: 'Knowledge & Training',
    icon: 'BookOpen',
    sections: [
      {
        title: 'Resources',
        items: [
          { label: 'Knowledge Center', href: '/rashi' },
          { label: 'Training', href: '/learning' },
        ],
      },
    ],
  },
  {
    id: 'settings',
    label: 'Release & Setup',
    icon: 'Settings',
    href: '/settings',
  },
];

export function isNavigationActive(href: string, pathname: string, search: string): boolean {
  const target = new URL(href, 'https://crm.local');
  if (pathname !== target.pathname && !pathname.startsWith(`${target.pathname}/`)) return false;
  const current = new URLSearchParams(search);
  if (target.searchParams.has('view')) return current.get('view') === target.searchParams.get('view');
  if (target.pathname === '/leads' && pathname === '/leads') return current.get('view') !== 'queue';
  return true;
}

export function activeNavigationHref(pathname: string, search: string): string | undefined {
  const hrefs = navigationCategories.flatMap((category) => category.sections
    ? category.sections.flatMap((section) => section.items.map((item) => item.href))
    : category.href ? [category.href] : []);
  return hrefs.filter((href) => isNavigationActive(href, pathname, search))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Navigation Helper: Get category by ID
 */
export function getCategoryById(id: string): NavCategory | undefined {
  return navigationCategories.find((cat) => cat.id === id);
}

/**
 * Navigation Helper: Get all categories with active status
 */
export function getAllCategories(): NavCategory[] {
  return navigationCategories;
}
