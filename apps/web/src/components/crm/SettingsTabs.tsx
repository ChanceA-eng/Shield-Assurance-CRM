'use client';

export const SETTINGS_TABS = [
  ['team', 'Team'],
  ['email', 'Email'],
  ['automation', 'Automation & Outreach'],
  ['intelligence', 'Lead discovery'],
  ['permissions', 'Marketing permission'],
  ['integrations', 'Integrations'],
] as const;
export type SettingsTab = typeof SETTINGS_TABS[number][0];

export default function SettingsTabs({ active, onSelect, visibleTabs = SETTINGS_TABS }: {
  active: SettingsTab; onSelect: (tab: SettingsTab) => void; visibleTabs?: readonly (readonly [SettingsTab, string])[];
}): JSX.Element {
  return <div role="tablist" aria-label="Settings sections" className="crm-tabs mb-5">
    {visibleTabs.map(([id, label], index) => <button key={id} type="button" onClick={() => onSelect(id)}
      role="tab" id={`tab-${id}`} aria-selected={active === id} aria-controls={`panel-${id}`}
      tabIndex={active === id ? 0 : -1}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % visibleTabs.length
          : event.key === 'ArrowLeft' ? (index + visibleTabs.length - 1) % visibleTabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? visibleTabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        const target = visibleTabs[next][0];
        const link = document.getElementById(`tab-${target}`);
        link?.focus();
        link?.click();
      }}
      className="crm-tab">
      {label}
    </button>)}
  </div>;
}
