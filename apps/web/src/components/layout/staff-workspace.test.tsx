import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SocialMarketingPage from '../../app/communication/social/page';
import ClientsPage from '../../app/clients/page';
import SchedulerPage from '../../app/scheduler/page';
import { StaffWorkspaceProvider } from '../../context/StaffWorkspaceContext';
import { NotificationProvider } from '../../context/NotificationContext';
import { NavProvider } from '../../context/NavContext';
import AppSidebar from './AppSidebar';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('../../lib/supabase-auth-browser', () => ({ createSupabaseBrowserAuthClient: createClient }));
vi.mock('../../context/WorkspaceNavigationContext', () => ({
  useUnsavedChanges: () => ({ confirmDiscard: () => true }),
}));
vi.mock('@fullcalendar/react', () => ({ default: () => null }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/communication/social',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it.each(['social-reader', 'social-editor'] as const)('renders only the supported %s controls', (workspace) => {
  const access = { mode: 'restricted' as const, grants: {
    'social.view': 'agency', ...(workspace === 'social-editor' ? { 'social.edit': 'agency' } : {}),
  } };
  const html = renderToStaticMarkup(
    <StaffWorkspaceProvider workspace={workspace} access={access}>
      <NotificationProvider enabled={false}>
        <NavProvider><AppSidebar /><SocialMarketingPage /></NavProvider>
      </NotificationProvider>
    </StaffWorkspaceProvider>,
  );
  expect(html).toContain('href="/communication/social"');
  expect(html).toContain('href="/account"');
  expect(html).not.toContain('href="/clients"');
  expect(html).not.toContain('href="/settings"');
  expect(html).not.toContain('Publishing calendar');
  expect(html).not.toContain('Connected accounts');
  expect(html.includes('New draft')).toBe(workspace === 'social-editor');
  expect(createClient).not.toHaveBeenCalled();
});

it('combines permitted record and marketing navigation without rendering the Owner account workspace', () => {
  const html = renderToStaticMarkup(
    <StaffWorkspaceProvider workspace="social-editor" records={['accounts', 'policies']} access={{ mode: 'restricted', grants: {
      'social.view': 'agency', 'social.edit': 'agency', 'accounts.view': 'assigned', 'policies.view': 'assigned',
    } }}>
      <NotificationProvider enabled={false}>
        <NavProvider><AppSidebar /><ClientsPage /></NavProvider>
      </NotificationProvider>
    </StaffWorkspaceProvider>,
  );
  expect(html).toContain('href="/clients"');
  expect(html).toContain('href="/policies"');
  expect(html).toContain('href="/communication/social"');
  expect(html).not.toContain('href="/leads"');
  expect(html).not.toContain('href="/settings"');
  expect(html).toContain('Loading accounts');
  expect(html).not.toContain('New Account');
});

it.each([
  { workspace: 'account' as const, grants: { 'calendar.view': 'agency' }, edit: false, tasks: false, send: false },
  { workspace: 'account' as const, grants: { 'calendar.view': 'agency', 'calendar.edit': 'agency', 'tasks.view': 'self' }, edit: true, tasks: true, send: false },
  { workspace: 'account' as const, grants: { 'calendar.view': 'self', 'calendar.edit': 'self' }, edit: true, tasks: false, send: false },
  { workspace: 'full' as const, grants: {}, edit: true, tasks: true, send: true },
])('renders calendar controls according to access', ({ workspace, grants, edit, tasks, send }) => {
  const html = renderToStaticMarkup(
    <StaffWorkspaceProvider workspace={workspace} access={{ mode: 'restricted', grants }}>
      <NotificationProvider enabled={false}><SchedulerPage /></NotificationProvider>
    </StaffWorkspaceProvider>,
  );
  expect(html.includes('+ New Event')).toBe(edit);
  expect(html.includes('Tasks due today or overdue')).toBe(tasks);
  expect(html.includes('Email contacts about cancellations and reschedules')).toBe(send);
});
