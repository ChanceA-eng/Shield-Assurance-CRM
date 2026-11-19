'use client';

const tabs = [
  ['team', 'Team'],
  ['email', 'Email'],
  ['automation', 'Automation & Outreach'],
  ['intelligence', 'Lead discovery'],
  ['permissions', 'Marketing permission'],
  ['integrations', 'Integrations'],
] as const;
export type SettingsTab = typeof tabs[number][0];

export default function SettingsTabs({ active, onSelect }: { active: SettingsTab; onSelect: (tab: SettingsTab) => void }): JSX.Element {
  return <div role="tablist" aria-label="Settings sections" className="crm-tabs mb-5">
    {tabs.map(([id, label], index) => <button key={id} type="button" onClick={() => onSelect(id)}
      role="tab" id={`tab-${id}`} aria-selected={active === id} aria-controls={`panel-${id}`}
      tabIndex={active === id ? 0 : -1}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
          : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        const target = tabs[next][0];
        const link = document.getElementById(`tab-${target}`);
        link?.focus();
        link?.click();
      }}
      className="crm-tab">
      {label}
    </button>)}
  </div>;
}
