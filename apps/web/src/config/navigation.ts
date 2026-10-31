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
          { label: 'Policy Transactions', href: '/policies/transactions' },
          { label: 'Policy Rewrites', href: '/policies/rewrites' },
          { label: 'Renewals', href: '/renewals' },
          { label: 'Claims', href: '/claims' },
          { label: 'Endorsements', href: '/endorsements' },
          { label: 'Certificates', href: '/certificates' },
          { label: 'ACORD Library', href: '/policies/acord' },
        ],
      },
      {
        title: 'Commissions',
        items: [
          { label: 'Statements', href: '/commissions/statements' },
          { label: 'Service Team Rules', href: '/commissions/rules' },
          { label: 'Manage Service Team', href: '/commissions/team' },
          { label: 'Commission Reports', href: '/commissions/reports' },
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
          { label: 'Scheduler', href: '/scheduler' },
          { label: 'Events', href: '/events' },
        ],
      },
    ],
  },
  {
    id: 'accounting',
    label: 'Accounting',
    icon: 'DollarSign',
    sections: [
      {
        title: 'Financial Management',
        items: [
          { label: 'Billing', href: '/billing' },
          { label: 'Accounting Center', href: '/accounting' },
          { label: 'Financial Reports', href: '/reports' },
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
          { label: 'Favorite Reports', href: '/reports/favorites' },
          { label: 'Scheduled Reports', href: '/reports/scheduled' },
          { label: 'Shared Reports', href: '/reports/shared' },
        ],
      },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'Settings',
    sections: [
      {
        title: 'Configuration',
        items: [
          { label: 'Agency Settings', href: '/settings' },
          { label: 'Manage Carriers', href: '/carriers' },
          { label: 'Security and Access', href: '/security' },
          { label: 'Integrations', href: '/marketplace' },
        ],
      },
    ],
  },
  {
    id: 'support',
    label: 'Support',
    icon: 'BookOpen',
    sections: [
      {
        title: 'Help and Resources',
        items: [
          { label: 'Solution Center', href: '/support' },
          { label: 'Training', href: '/learning' },
        ],
      },
    ],
  },
];

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
