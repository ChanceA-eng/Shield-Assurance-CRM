'use client';

import React, { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import EmailProviderControl, { type EmailProviderChoice } from './EmailProviderControl';
import ConversationTool, { ConversationTools } from './ConversationTool';
import { documentFromText, emailDocumentText, type EmailDesign, type EmailDocument } from '@crm/shared';
import EmailDesignPreview from './EmailDesignPreview';
import EmailTextEditor from './EmailTextEditor';
import MessageTagTool from './MessageTagTool';

export const composerSendClass = 'inline-flex items-center justify-center gap-2 rounded bg-cui-primary px-3 py-2 text-sm font-semibold text-white hover:brightness-95 disabled:opacity-50';
export const composerDraftClass = 'inline-flex items-center justify-center gap-2 rounded border border-cui-primary px-3 py-2 text-sm font-semibold text-cui-primary hover:bg-cui-primary/10 disabled:opacity-50';

export default function MessageComposer({ subject, body, onSubjectChange, onBodyChange, disabled,
  channel = 'email', subjectLabel = 'Message subject', bodyLabel = 'Message body', bodyPlaceholder = 'Write a message',
  templates, sender, children, actions, footer, tools, reply, draftAction, attachments, summary, draftFeedback, attachmentsSelected = false, schedule,
  emailProvider, onEmailProviderChange, emailDesign, expanded = false, bodyDocument, onDocumentChange, conversationKey,
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
  conversationKey?: string;
}): JSX.Element {
  const [collapsed, setCollapsed] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [tagTarget, setTagTarget] = useState<'subject' | 'body'>('body');
  const subjectInput = useRef<HTMLInputElement>(null), bodyInput = useRef<HTMLTextAreaElement>(null);
  const richInsert = useRef<((text: string) => void) | null>(null);
  const selection = useRef<{ start: number; end: number } | null>(null);
  const remember = (target: 'subject' | 'body', element: HTMLInputElement | HTMLTextAreaElement): void => {
    setTagTarget(target); selection.current = { start: element.selectionStart ?? element.value.length, end: element.selectionEnd ?? element.value.length };
  };
  const insertDetail = (text: string): void => {
    if (tagTarget === 'body' && formatting && onDocumentChange && richInsert.current) {
      requestAnimationFrame(() => richInsert.current?.(text)); return;
    }
    const current = tagTarget === 'subject' ? subject : body;
    const inserted = tagTarget === 'subject' ? text.replace(/[\r\n]+/g, ' ') : text;
    const start = Math.min(selection.current?.start ?? current.length, current.length);
    const end = Math.min(selection.current?.end ?? current.length, current.length);
    const next = current.slice(0, start) + inserted + current.slice(end), position = start + inserted.length;
    if (tagTarget === 'subject') onSubjectChange(next); else onBodyChange(next);
    selection.current = { start: position, end: position };
    requestAnimationFrame(() => {
      const element = tagTarget === 'subject' ? subjectInput.current : bodyInput.current;
      element?.focus(); element?.setSelectionRange(position, position);
    });
  };
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
    <div role="toolbar" aria-label="Conversation actions" className="flex flex-wrap items-center sm:gap-x-1" data-conversation-toolbar>
      {templates}
      {conversationKey ? <MessageTagTool key={conversationKey} conversation={conversationKey} disabled={disabled} onInsert={insertDetail} /> : null}
      {channel === 'email' && onDocumentChange ? <button type="button" className="crm-button h-9 min-w-8 px-1 py-1 text-[11px] sm:h-8 sm:px-2 sm:text-xs"
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
      <input ref={subjectInput} aria-label={subjectLabel} disabled={disabled} value={subject} placeholder="Subject"
        onFocus={(event) => remember('subject', event.currentTarget)} onSelect={(event) => remember('subject', event.currentTarget)}
        onBlur={(event) => remember('subject', event.currentTarget)}
        onChange={(event) => onSubjectChange(event.target.value)} className={`mt-1 ${fieldClass}`} />
    </label> : null}
    {channel === 'email' && formatting && onDocumentChange ? <div onFocus={() => setTagTarget('body')}><EmailTextEditor compact label={bodyLabel} disabled={disabled}
      insertTextRef={richInsert}
      value={bodyDocument ?? documentFromText(body)} onChange={(document) => {
        onBodyChange(emailDocumentText(document)); onDocumentChange(document);
      }} /></div> : <label className="block text-xs font-semibold text-cui-muted"><span className="sr-only">{bodyLabel}</span>
      <textarea ref={bodyInput} aria-label={bodyLabel} disabled={disabled} value={body} rows={5} placeholder={bodyPlaceholder}
        onFocus={(event) => remember('body', event.currentTarget)} onSelect={(event) => remember('body', event.currentTarget)}
        onBlur={(event) => remember('body', event.currentTarget)}
        onChange={(event) => onBodyChange(event.target.value)}
        className={`mt-1 ${expanded ? 'h-[clamp(7rem,20dvh,14rem)]' : 'h-[clamp(6rem,17dvh,10rem)]'} [@media(max-height:640px)]:h-20 resize-none overflow-y-auto leading-6 ${fieldClass}`} />
    </label>}
    {actions || schedule ? <div className="flex items-center gap-2 bg-white" data-composer-send-actions>{actions}{schedule}</div> : null}
    </div>
    </ConversationTools>
  </div>;
}
