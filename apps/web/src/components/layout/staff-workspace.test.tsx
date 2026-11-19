import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SocialMarketingPage from '../../app/communication/social/page';
import ClientsPage from '../../app/clients/page';
import { StaffWorkspaceProvider } from '../../context/StaffWorkspaceContext';
import { NotificationProvider } from '../../context/NotificationContext';
import { NavProvider } from '../../context/NavContext';
import AppSidebar from './AppSidebar';

const { createClient } = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('../../lib/supabase-auth-browser', () => ({ createSupabaseBrowserAuthClient: createClient }));
vi.mock('../../context/WorkspaceNavigationContext', () => ({
  useUnsavedChanges: () => ({ confirmDiscard: () => true }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/communication/social',
  useSearchParams: () => new URLSearchParams(),
}));

beforeEach(() => vi.stubGlobal('React', React));
afterEach(() => vi.unstubAllGlobals());

it.each(['social-reader', 'social-editor'] as const)('renders only the supported %s controls', (workspace) => {
  const html = renderToStaticMarkup(
    <StaffWorkspaceProvider workspace={workspace}>
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
    <StaffWorkspaceProvider workspace="social-editor" records={['accounts', 'policies']}>
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
