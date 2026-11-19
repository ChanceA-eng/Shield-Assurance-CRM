'use client';

import { CRM_HELP_EVENT, type CrmHelpTopic } from '../../lib/crm-help';

export default function AskRashi({ topic, detail, label = 'Ask Rashi', onOpen }: {
  topic: CrmHelpTopic; detail?: string; label?: string; onOpen?: () => void;
}): JSX.Element {
  return <button type="button" className="crm-button" onClick={() => {
    onOpen?.();
    window.dispatchEvent(new CustomEvent(CRM_HELP_EVENT, { detail: { topic, detail } }));
  }}>{label}</button>;
}
