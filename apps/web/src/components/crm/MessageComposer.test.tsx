import { describe, expect, it, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MessageComposer, { composerSendClass, composerDraftClass } from './MessageComposer';
import ConversationMessage from './ConversationMessage';
import ConversationTool from './ConversationTool';

describe('shared communication presentation', () => {
  const props = { subject: 'Policy review', body: 'Keep my draft', onSubjectChange: vi.fn(), onBodyChange: vi.fn(), disabled: false };
  it('uses the same email fields and ordered feature slots without changing caller-specific actions', () => {
    const html = renderToStaticMarkup(<MessageComposer {...props}
      templates={<ConversationTool label="Templates">Sales library</ConversationTool>} actions={<button className={composerSendClass}>Approve reply</button>}
      schedule={<ConversationTool label="Schedule send" action>Schedule control</ConversationTool>}><span>Record-specific options</span></MessageComposer>);
    expect(html).toContain('data-message-composer="email"');
    expect(html).toContain('aria-label="Message subject"');
    expect(html).toContain('aria-label="Message body"');
    expect(html).toContain('Keep my draft');
    const order = ['data-conversation-tool="Templates"', 'data-conversation-tool="Draft"', 'aria-label="Message subject"', 'aria-label="Message body"', 'Approve reply', 'data-conversation-tool="Schedule send"'];
    expect(order.map((text) => html.indexOf(text))).toEqual(order.map((text) => html.indexOf(text)).sort((a, b) => a - b));
    expect(composerSendClass).toContain('bg-cui-primary');
    expect(composerDraftClass).toContain('border-cui-primary');
    expect(html).toContain('aria-label="Conversation actions"');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('Minimize editor');
    expect(html).not.toContain('<details');
    expect(html).not.toContain('Write email');
    expect(html).not.toContain('Record-specific options');
    expect(html).toContain('data-composer-send-actions');
  });
  it('keeps SMS body-only and locks fields during an in-flight action', () => {
    const html = renderToStaticMarkup(<MessageComposer {...props} channel="sms" disabled />);
    expect(html).not.toContain('<input');
    expect(html).toContain('data-message-composer="sms"');
    expect(html).not.toContain('Write text');
    expect(html).toContain('disabled=""');
  });
  it('preserves explicit Gmail reply labels and expansion without inventing features', () => {
    const html = renderToStaticMarkup(<MessageComposer {...props} expanded subjectLabel="Reply subject" bodyLabel="Reply for your review" />);
    expect(html).toContain('aria-label="Reply subject"');
    expect(html).toContain('aria-label="Reply for your review"');
    expect(html).toContain('resize-none');
    expect(html).toContain('max-w-4xl');
    expect(html).toContain('Minimize editor');
  });
  it('renders inbound, outbound and scheduled messages with shared chrome and escaped text', () => {
    const inbound = renderToStaticMarkup(<ConversationMessage outbound={false} channel="sms" body="<script>not executable</script>" />);
    const outbound = renderToStaticMarkup(<ConversationMessage outbound channel="email" subject="Review" body="Hello" scheduled><span>Delivery receipt</span></ConversationMessage>);
    expect(inbound).toContain('bg-cui-light/60');
    expect(inbound).not.toContain('<script>');
    expect(outbound).toContain('border-cui-primary/30');
    expect(outbound).toContain('border-dashed');
    expect(outbound).toContain('Delivery receipt');
  });
});
