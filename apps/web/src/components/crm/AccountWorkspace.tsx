'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import MyAccountForm from './MyAccountForm';
import AccountSecurity from './AccountSecurity';
import AgentCommunicationSettings from './AgentCommunicationSettings';
import PersonalGmailConnectionSettings from './PersonalGmailConnectionSettings';
import PersonalSignature from './PersonalSignature';
import GoogleCalendarSettings from './GoogleCalendarSettings';

const accountTabs = [['profile', 'Profile'], ['security', 'Security'], ['signature', 'Signature / Mailbox']] as const;
export type AccountTab = typeof accountTabs[number][0];
export default function AccountWorkspace({ initialTab, mailboxMode, personalOnly = false }: { initialTab: AccountTab; mailboxMode: 'shared' | 'send_only' | 'disabled'; personalOnly?: boolean }): JSX.Element {
  const tabs = accountTabs;
  const [active, setActive] = useState(initialTab);
  const [visited, setVisited] = useState<Set<AccountTab>>(new Set([initialTab]));
  const currentTab = active;
  const router = useRouter();
  const select = (tab: AccountTab): void => {
    setActive(tab); setVisited((current) => new Set([...current, tab]));
    window.history.replaceState(null, '', `/account?tab=${tab}`);
  };
  return <div className="mx-auto max-w-5xl">
    <div role="tablist" aria-label="My Account sections" className="crm-tabs mb-5">
      {tabs.map(([tab, label], index) => <button key={tab} role="tab" id={`account-tab-${tab}`}
        aria-controls={`account-panel-${tab}`} aria-selected={currentTab === tab} tabIndex={currentTab === tab ? 0 : -1}
        onClick={() => select(tab)} onKeyDown={(event) => {
          const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
            : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
          if (target === null) return;
          event.preventDefault(); select(tabs[target][0]); document.getElementById(`account-tab-${tabs[target][0]}`)?.focus();
        }} className="crm-tab">{personalOnly && tab === 'signature' ? 'Signature' : label}</button>)}
    </div>
    {tabs.map(([tab]) => <div key={tab} role="tabpanel" hidden={currentTab !== tab} id={`account-panel-${tab}`} aria-labelledby={`account-tab-${tab}`}>
      {visited.has(tab) || currentTab === tab ? tab === 'profile' ? <MyAccountForm onSaved={() => router.refresh()} /> : tab === 'security' ? <AccountSecurity /> : personalOnly ? <PersonalSignature /> : mailboxMode === 'shared'
        ? <div className="space-y-5"><PersonalSignature /><AgentCommunicationSettings /><GoogleCalendarSettings /></div> : <div className="space-y-5"><PersonalSignature /><PersonalGmailConnectionSettings /><GoogleCalendarSettings /></div> : null}
    </div>)}
  </div>;
}
