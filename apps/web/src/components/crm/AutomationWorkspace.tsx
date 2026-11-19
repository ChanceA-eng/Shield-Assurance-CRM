'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import BuiltInAutomationSettings from './BuiltInAutomationSettings';
import CustomWorkflowSettings from './CustomWorkflowSettings';
import AgencyOutreachSettings from './AgencyOutreachSettings';
import AutomationHealth from './AutomationHealth';
import SalesTemplateSettings from './SalesTemplateSettings';

const sections = [['rules', 'Rules'], ['sequences', 'Sequences'], ['templates', 'Sales templates'], ['sender', 'Sender'], ['runs', 'Runs']] as const;
export type AutomationSection = typeof sections[number][0];

export default function AutomationWorkspace({ section: requestedSection, active = true }: { section: AutomationSection; active?: boolean }): JSX.Element {
  const params = useSearchParams();
  const location = { section: requestedSection, custom: params.get('rules') === 'custom', rule: params.get('rule'), page: params.get('page') ?? '0' };
  const [savedLocation, setSavedLocation] = useState(location);
  if (active && (savedLocation.section !== location.section || savedLocation.custom !== location.custom
    || savedLocation.rule !== location.rule || savedLocation.page !== location.page)) setSavedLocation(location);
  const { section, custom, rule, page } = active ? location : savedLocation;
  return <div className="space-y-4">
    <nav aria-label="Automation sections" className="crm-tabs">
      {sections.map(([id, label]) => <a key={id} href={`/settings?tab=automation&section=${id}`}
        aria-current={section === id ? 'page' : undefined}
        className="crm-tab">{label}</a>)}
    </nav>
    {section === 'rules' ? <><nav aria-label="Rule types" className="flex gap-4 border-b border-cui-border text-sm">
      {[['built-in', 'Built-in rules'], ['custom', 'Custom rules']].map(([id, label]) => <a key={id}
        href={`/settings?tab=automation&section=rules&rules=${id}`}
        aria-current={(custom ? id === 'custom' : id === 'built-in') ? 'page' : undefined}
        className={`border-b-2 pb-2 font-semibold ${(custom ? id === 'custom' : id === 'built-in') ? 'border-cui-primary text-cui-primary' : 'border-transparent text-cui-muted'}`}>{label}</a>)}
    </nav>{custom ? <CustomWorkflowSettings selection={{ rule: rule || null, page }} /> : <BuiltInAutomationSettings />}</> : null}
    {section === 'sequences' ? <><BuiltInAutomationSettings sequences /><AgencyOutreachSettings section="sending" /></> : null}
    {section === 'sender' ? <AgencyOutreachSettings section="sender" /> : null}
    {section === 'runs' ? <AutomationHealth active={active} /> : null}
    {section === 'templates' ? <SalesTemplateSettings /> : null}
  </div>;
}
