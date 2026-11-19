import { describe, expect, it } from 'vitest';
import { emailHtmlToText, readableEmail } from './email-text';

describe('readable email presentation', () => {
  it('cleans mailbox whitespace without losing paragraphs or addresses', () => {
    expect(readableEmail('\r\nHello,\u00a0\r\n\r\n\r\nPlease call.\u200b\r\n\r\nThanks,\r\nClient\r\n'))
      .toEqual({ text: 'Hello,\n\nPlease call.\n\nThanks,\nClient', quoted: null });
  });
  it('separates quoted history without deleting the original content', () => {
    const body = 'Yes, tomorrow works.\n\nOn Wed, Nov 4, Agent <agent@example.invalid> wrote:\n> Can we talk?';
    const result = readableEmail(body);
    expect(result.text).toBe('Yes, tomorrow works.');
    expect(result.quoted).toBe('On Wed, Nov 4, Agent <agent@example.invalid> wrote:\n> Can we talk?');
  });
  it('recognizes Outlook headers only when supported by another header', () => {
    expect(readableEmail('New answer\n\nFrom: Agent\nSent: Wednesday\nSubject: Policy\n\nOld message').quoted).toContain('From: Agent');
    expect(readableEmail('Please update:\nFrom: Phoenix\nCoverage: Auto').quoted).toBeNull();
    expect(readableEmail('> Entire quoted message').text).toBe('> Entire quoted message');
  });
  it.each([
    'On Wed, Nov 4, 2026 at 8:39 PM Chance Amani <camani@shield-assurance.com>\nwrote:',
    '(On Wed, Nov 4, 2026 at 8:39 PM Chance Amani <camani@shield-assurance.com>\nwrote:)',
    'On Wed, Nov 4, 2026 at 8:39 PM\nChance Amani\n<camani@shield-assurance.com>\nwrote:',
  ])('collapses a wrapped Gmail attribution: %s', (header) => {
    const result = readableEmail(`Thanks, **please call tomorrow**.\n\n${header}\n> Original message`);
    expect(result.text).toBe('Thanks, **please call tomorrow**.');
    expect(result.quoted).toBe(`${header}\n> Original message`);
  });
  it('does not hide prose beginning with On when wrote appears in another sentence', () => {
    expect(readableEmail('New answer\n\nOn this policy we need more coverage.\nHere is what I wrote:\nPlease increase it.').quoted).toBeNull();
  });
  it('does not collapse mathematical comparisons or message-only quoted content', () => {
    expect(readableEmail('Limits\n> $1 million\nPlease confirm').quoted).toBeNull();
    expect(readableEmail('On Wednesday I wrote:\nThis is the only content.').quoted).toBeNull();
  });
  it('converts HTML structure, entities, lists and links into readable safe text', () => {
    const html = '<style>hidden</style><p>Hello&nbsp;Jane &#x1F44B;</p><p>&quot;Quote&quot; &amp; coverage &#39;details&#39;</p><ul><li>Auto</li><li>Home</li></ul><p><a href="https://example.invalid/policy">View policy</a></p><script>doNotRun()</script>';
    expect(readableEmail(emailHtmlToText(html)).text).toBe('Hello Jane 👋\n\n"Quote" & coverage \'details\'\n\n- Auto\n- Home\n\nView policy (https://example.invalid/policy)');
    expect(emailHtmlToText('&#x110000; &#0; &#xd800;')).toBe('&#x110000; &#0; &#xd800;');
  });
  it('preserves newlines and plain-text angle brackets without treating them as HTML', () => {
    expect(readableEmail('Contact <client@example.invalid>\n\nCoverage < $5000').text)
      .toBe('Contact <client@example.invalid>\n\nCoverage < $5000');
  });
});
