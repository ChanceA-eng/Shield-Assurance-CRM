import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import EmailMessageBody from '../components/crm/EmailMessageBody';

describe('formatted email bodies', () => {
  it('renders actual bold, lists and paragraphs rather than literal markdown markers', () => {
    const html = renderToStaticMarkup(<EmailMessageBody body={'Hello **Jane**,\n\nPlease send:\n\n- **Auto** quote\n- Home quote'} />);
    expect(html).toContain('<strong');
    expect(html).not.toContain('**');
    expect(html).toContain('<ul');
    expect(html).toContain('Home quote');
  });
  it('preserves email addresses, comparisons and explicit line breaks', () => {
    const html = renderToStaticMarkup(<EmailMessageBody body={'Contact <client@example.invalid>\nCoverage < $5000\nThanks,\nJane'} />);
    expect(html).toContain('client@example.invalid');
    expect(html).toContain('Coverage &lt; $5000');
    expect(html).toContain('Thanks,\nJane');
  });
  it('keeps wrapped reply headers and old content only inside closed quoted history', () => {
    const html = renderToStaticMarkup(<EmailMessageBody body={'New reply\n\nOn Wed, Nov 4, 2026 Agent <agent@example.invalid>\nwrote:\n> Old body'} />);
    const [main, quoted] = html.split('<details');
    expect(main).toContain('New reply');
    expect(main).not.toContain('wrote:');
    expect(quoted).toContain('Show quoted email');
    expect(quoted).toContain('Old body');
    expect(quoted).not.toContain(' open');
  });
  it('never injects HTML, remote tracking images or unsafe links from message content', () => {
    const html = renderToStaticMarkup(<EmailMessageBody body={'<script>alert(1)</script>\n\n![tracker](https://tracker.example.invalid/pixel)\n\n[bad](javascript:alert)\n\n[safe](https://example.invalid)'} />);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('href="https://example.invalid"');
  });
});
