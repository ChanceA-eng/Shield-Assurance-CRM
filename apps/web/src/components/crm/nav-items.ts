import type { Route } from 'next';

export interface NavItem {
  label: string;
  icon: string;
  path: Route;
  group: 'Core' | 'Insurance Ops' | 'Admin';
}

export const navItems: NavItem[] = [
  { label: 'Home', icon: 'home', path: '/', group: 'Core' },
  { label: 'Leads', icon: 'user-plus', path: '/leads', group: 'Core' },
  { label: 'Clients', icon: 'users', path: '/clients', group: 'Core' },
  { label: 'Policies', icon: 'file-text', path: '/policies', group: 'Core' },
  { label: 'Tasks', icon: 'check-square', path: '/tasks', group: 'Core' },
  { label: 'Events', icon: 'calendar', path: '/events', group: 'Core' },
  { label: 'Scheduler', icon: 'calendar-days', path: '/scheduler', group: 'Core' },

  { label: 'Renewals', icon: 'refresh-cw', path: '/renewals', group: 'Insurance Ops' },
  { label: 'Claims', icon: 'alert-triangle', path: '/claims', group: 'Insurance Ops' },
  { label: 'Endorsements', icon: 'edit', path: '/endorsements', group: 'Insurance Ops' },
  { label: 'Certificates', icon: 'award', path: '/certificates', group: 'Insurance Ops' },
  { label: 'Billing Issues', icon: 'dollar-sign', path: '/billing', group: 'Insurance Ops' },

  { label: 'Rashi', icon: 'briefcase', path: '/rashi' as Route, group: 'Admin' },
  { label: 'Reports', icon: 'bar-chart-2', path: '/reports', group: 'Admin' },
  { label: 'Settings', icon: 'settings', path: '/settings', group: 'Admin' },
];
