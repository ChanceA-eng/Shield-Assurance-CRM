import React, { type ReactNode } from 'react';
import EmailMessageBody from './EmailMessageBody';

export default function ConversationMessage({ outbound, channel, subject, body, header, children, scheduled = false, plainText = false, messageId }: {
  outbound: boolean; channel: string | null; subject?: string | null; body?: string | null;
  header?: ReactNode; children?: ReactNode; scheduled?: boolean; plainText?: boolean;
  messageId?: string;
}): JSX.Element {
  return <div data-conversation-message={outbound ? 'outbound' : 'inbound'} data-history-id={messageId}
    className={`min-w-0 max-w-[min(92%,44rem)] overflow-hidden break-words rounded border p-3 text-sm text-cui-text ${outbound
      ? 'ml-auto border-cui-primary/30 bg-cui-primary/5' : 'border-cui-border bg-cui-light/60'} ${scheduled ? 'border-dashed' : ''}`}>
    {header ? <div className="mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-cui-muted">{header}</div> : null}
    {subject ? <p className="mb-2 font-semibold">{subject}</p> : null}
    {channel === 'email' && !plainText ? <EmailMessageBody body={body || '--'} /> : <p className="whitespace-pre-wrap">{body || '--'}</p>}
    {children}
  </div>;
}
