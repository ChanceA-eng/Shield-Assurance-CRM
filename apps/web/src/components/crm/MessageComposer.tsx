'use client';

import React, { useId, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import EmailProviderControl, { type EmailProviderChoice } from './EmailProviderControl';
import ConversationTool, { ConversationTools } from './ConversationTool';
import { documentFromText, emailDocumentText, type EmailDesign, type EmailDocument } from '@crm/shared';
import EmailDesignPreview from './EmailDesignPreview';
import EmailTextEditor from './EmailTextEditor';

export const composerSendClass = 'inline-flex items-center justify-center gap-2 rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50';
export const composerDraftClass = 'inline-flex items-center justify-center gap-2 rounded border border-cui-primary px-3 py-2 text-sm font-semibold text-cui-primary hover:bg-cui-primary/10 disabled:opacity-50';

export default function MessageComposer({ subject, body, onSubjectChange, onBodyChange, disabled,
  channel = 'email', subjectLabel = 'Message subject', bodyLabel = 'Message body', bodyPlaceholder = 'Write a message',
  templates, sender, children, actions, footer, tools, reply, draftAction, attachments, summary, draftFeedback, attachmentsSelected = false, schedule,
  emailProvider, onEmailProviderChange, emailDesign, expanded = false, bodyDocument, onDocumentChange,
}: {
  subject: string; body: string; onSubjectChange: (value: string) => void; onBodyChange: (value: string) => void;
  disabled: boolean; channel?: 'email' | 'sms'; subjectLabel?: string; bodyLabel?: string; bodyPlaceholder?: string;
  templates?: ReactNode; sender?: ReactNode; children?: ReactNode; actions?: ReactNode; footer?: ReactNode; tools?: ReactNode; reply?: ReactNode; expanded?: boolean;
  draftAction?: ReactNode;
  attachments?: ReactNode; summary?: ReactNode;
  attachmentsSelected?: boolean;
  draftFeedback?: ReactNode;
  schedule?: ReactNode;
  emailProvider?: EmailProviderChoice; onEmailProviderChange?: (provider: EmailProviderChoice) => void;
  emailDesign?: EmailDesign;
  bodyDocument?: EmailDocument; onDocumentChange?: (document: EmailDocument) => void;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const editorId = useId();
  const fieldClass = 'w-full min-w-0 rounded border border-cui-border bg-white px-3 py-2 text-sm text-cui-text outline-none focus:border-cui-primary focus:ring-1 focus:ring-cui-primary disabled:opacity-60';
  return <div data-message-composer={channel} className="mx-auto w-full min-w-0 max-w-4xl">
    <ConversationTools>
    <div className="mb-1 flex min-w-0 items-center justify-between gap-2">
      {collapsed ? <span className="truncate text-xs font-semibold text-cui-muted">{subject || (body ? 'Unsent draft' : 'New message')}</span> : null}
      <div hidden={collapsed} className="min-w-0 flex-1">
        {channel === 'email' && emailProvider && onEmailProviderChange ? <div className="flex min-w-0 flex-wrap items-center gap-2">
          {sender}<EmailProviderControl value={emailProvider} onChange={onEmailProviderChange} disabled={disabled} compact />
        </div> : <span className="text-xs font-semibold text-cui-muted">{channel === 'email' ? 'Email' : 'Text message'}</span>}
      </div>
      <button type="button" aria-expanded={!collapsed} aria-controls={editorId}
        onClick={() => setCollapsed((value) => !value)}
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs font-semibold text-cui-muted hover:bg-cui-light">
        {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {collapsed ? 'Expand editor' : 'Minimize editor'}
      </button>
    </div>
    <div id={editorId} hidden={collapsed} className="space-y-1">
    <div role="toolbar" aria-label="Conversation actions" className="flex flex-wrap items-center gap-x-1" data-conversation-toolbar>
      {templates}
      {channel === 'email' && onDocumentChange ? <button type="button" className="crm-button px-2 py-1 text-xs"
        aria-pressed={formatting} disabled={disabled} onClick={() => setFormatting(!formatting)}>Format email</button> : null}
      {channel === 'email' && (emailDesign || bodyDocument) ? <ConversationTool label="Preview" title="Branded email preview" large>
        <EmailDesignPreview body={body} design={emailDesign} formatting={{ bodyDocument }} />
      </ConversationTool> : null}
      {draftAction || children ? <ConversationTool label="Draft" title="Draft with AI">
        {draftFeedback}{children}{draftAction}
      </ConversationTool> : null}
      {reply}
      {tools}
      {footer}
      {attachments ? <ConversationTool label="Attach" title="Attachments" large selected={attachmentsSelected}>{attachments}</ConversationTool> : null}
      {summary ? <ConversationTool label="Summary" title="Conversation summary">{summary}</ConversationTool> : null}
    </div>
    {channel === 'email' ? <label className="block text-xs font-semibold text-cui-muted"><span className="sr-only">{subjectLabel}</span>
      <input aria-label={subjectLabel} disabled={disabled} value={subject} placeholder="Subject"
        onChange={(event) => onSubjectChange(event.target.value)} className={`mt-1 ${fieldClass}`} />
    </label> : null}
    {channel === 'email' && formatting && onDocumentChange ? <EmailTextEditor compact label={bodyLabel} disabled={disabled}
      value={bodyDocument ?? documentFromText(body)} onChange={(document) => {
        onBodyChange(emailDocumentText(document)); onDocumentChange(document);
      }} /> : <label className="block text-xs font-semibold text-cui-muted"><span className="sr-only">{bodyLabel}</span>
      <textarea aria-label={bodyLabel} disabled={disabled} value={body} rows={5} placeholder={bodyPlaceholder}
        onChange={(event) => onBodyChange(event.target.value)}
        className={`mt-1 ${expanded ? 'h-[clamp(7rem,20dvh,14rem)]' : 'h-[clamp(6rem,17dvh,10rem)]'} [@media(max-height:640px)]:h-20 resize-none overflow-y-auto leading-6 ${fieldClass}`} />
    </label>}
    {actions || schedule ? <div className="flex items-center gap-2 bg-white" data-composer-send-actions>{actions}{schedule}</div> : null}
    </div>
    </ConversationTools>
  </div>;
}
