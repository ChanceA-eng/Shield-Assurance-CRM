'use client';

import { useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import SettingsTabs, { SETTINGS_TABS, type SettingsTab } from './SettingsTabs';
import EmailConnectionSettings from './EmailConnectionSettings';
import AgencyTeamSettings from './AgencyTeamSettings';
import AccountEmailApprovals from './AccountEmailApprovals';
import AutomationWorkspace, { type AutomationSection } from './AutomationWorkspace';
import EmailPermissionSettings from './EmailPermissionSettings';
import IntegrationStatusWorkspace from './IntegrationStatusWorkspace';
import BusinessResearchSettings from './BusinessResearchSettings';
import OpportunitySettings from './OpportunitySettings';
import DiscoverySourceSettings from './DiscoverySourceSettings';
import type { TeamSettingsData } from '../../lib/team-settings';
import type { EmailChange } from '../../lib/account-security';

function currentTab(requested: string | null): SettingsTab {
  if (requested === 'outreach' || requested === 'operations') return 'automation';
  return requested === 'email' || requested === 'integrations' || requested === 'automation'
    || requested === 'intelligence' || requested === 'permissions' ? requested : 'team';
}

function DiscoverySettings({ active }: { active: boolean }): JSX.Element {
  const tool = useSearchParams().get('tool');
  const requested = tool === 'targeting' || tool === 'sources' ? tool : 'research';
  const [lastSection, setLastSection] = useState(requested);
  if (active && lastSection !== requested) setLastSection(requested);
  const section = active ? requested : lastSection;
  const [visited, setVisited] = useState([section]);
  if (!visited.includes(section)) setVisited([...visited, section]);
  return <div className="space-y-4">
    <nav aria-label="Lead discovery tools" className="flex flex-wrap gap-2">
      {([['research', 'Business research'], ['targeting', 'Targeting'], ['sources', 'Source approvals']] as const).map(([id, label]) =>
        <button key={id} type="button" aria-pressed={section === id} onClick={() => window.history.pushState(null, '', `/settings?tab=intelligence&tool=${id}`)}
          className={section === id ? 'crm-button-primary' : 'crm-button'}>{label}</button>)}
    </nav>
    {visited.map((id) => <div key={id} hidden={section !== id}>
      {id === 'research' ? <BusinessResearchSettings /> : id === 'targeting' ? <OpportunitySettings /> : <DiscoverySourceSettings />}
    </div>)}
  </div>;
}

export default function SettingsWorkspace({ team, emailRequests, restricted = false, allowedTabs }: {
  team: TeamSettingsData | null; emailRequests: EmailChange[] | null; restricted?: boolean; allowedTabs?: readonly SettingsTab[];
}): JSX.Element {
  const params = useSearchParams();
  const visibleTabs = restricted
    ? SETTINGS_TABS.filter(([id]) => allowedTabs?.includes(id) ?? false)
    : SETTINGS_TABS;
  const requestedTab = currentTab(params.get('tab'));
  const tab = visibleTabs.some(([id]) => id === requestedTab) ? requestedTab : visibleTabs[0]?.[0] ?? 'team';
  const requestedSection = params.get('section');
  const section: AutomationSection = requestedSection === 'sequences' || requestedSection === 'sender'
    || requestedSection === 'runs' || requestedSection === 'templates' ? requestedSection
      : params.get('tab') === 'outreach' ? 'sender' : params.get('tab') === 'operations' ? 'runs' : 'rules';
  const [visited, setVisited] = useState<SettingsTab[]>([tab]);
  const destinations = useRef<Partial<Record<SettingsTab, string>>>({});
  if (!visited.includes(tab)) setVisited([...visited, tab]);

  const select = (next: SettingsTab): void => {
    if (next === tab) return;
    destinations.current[tab] = `${window.location.pathname}${window.location.search}`;
    window.history.pushState(null, '', destinations.current[next] ?? `/settings?tab=${next}`);
  };
  const followSettingsLink = (event: MouseEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
    if (!(link instanceof HTMLAnchorElement) || link.target || link.hasAttribute('download')) return;
    const target = new URL(link.href);
    if (target.origin !== window.location.origin || target.pathname !== '/settings') return;
    event.preventDefault();
    window.history.pushState(null, '', `${target.pathname}${target.search}`);
  };
  return <div onClick={followSettingsLink}>
    <SettingsTabs active={tab} onSelect={select} visibleTabs={visibleTabs} />
    {visited.map((id) => <div key={id} role="tabpanel" hidden={tab !== id} id={`panel-${id}`}
      aria-labelledby={`tab-${id}`} tabIndex={0} className="space-y-5 focus:outline-none">
      {id === 'team' ? <><AgencyTeamSettings initial={team} />{!restricted ? <AccountEmailApprovals initial={emailRequests} /> : null}</> : null}
      {id === 'email' ? <EmailConnectionSettings /> : null}
      {id === 'automation' ? <AutomationWorkspace section={section} active={tab === id} /> : null}
      {id === 'intelligence' ? <DiscoverySettings active={tab === id} /> : null}
      {id === 'permissions' ? <EmailPermissionSettings /> : null}
      {id === 'integrations' ? <IntegrationStatusWorkspace /> : null}
    </div>)}
  </div>;
}
