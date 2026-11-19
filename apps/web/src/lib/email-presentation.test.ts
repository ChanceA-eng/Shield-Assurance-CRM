import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_EMAIL_DESIGN, emailDesignErrors, emailDesignText, ensureWebsiteLink, parseEmailDesign, renderEmailHtml } from '@crm/shared';
import { agentMime } from './agent-email';
import { appendPersonalSignature, appendAgencySignature } from './agency-signature';

describe('recipient email presentation', () => {
  const design = { ...DEFAULT_EMAIL_DESIGN, layout: 'announcement' as const, brand_name: 'Agency & Co',
    heading: 'Welcome <friend>', logo_url: 'https://assets.example.invalid/logo.png',
    image_url: 'https://assets.example.invalid/banner.png', image_alt: 'An office',
    button_label: 'Review options', button_url: 'https://example.invalid/review?a=1&b=2' };
  it('renders safe branded HTML and a usable plain-text equivalent', () => {
    const body = 'Hello <client>\n\n-- \nAgent';
    const html = renderEmailHtml(body, design);
    expect(html).toContain('src="https://assets.example.invalid/banner.png"');
    expect(html).toContain('alt="An office"');
    expect(html).toContain('Welcome &lt;friend&gt;');
    expect(html).toContain('Hello &lt;client&gt;');
    expect(html).toContain('href="https://example.invalid/review?a=1&amp;b=2"');
    expect(emailDesignText(body, design)).toContain('Review options: https://example.invalid/review?a=1&b=2\n\n-- \nAgent');
    expect(renderEmailHtml(body, design).indexOf('banner.png')).toBeLessThan(html.indexOf('Hello &lt;client&gt;'));
  });
  it('links the banner to its destination without using the image address as the click target', () => {
    const destination = 'https://example.invalid/quote?from=banner&category=auto';
    const linked = { ...design, image_link_url: destination };
    expect(parseEmailDesign(linked)?.image_link_url).toBe(destination);
    expect(renderEmailHtml('Hello', linked)).toContain(
      '<a href="https://example.invalid/quote?from=banner&amp;category=auto" style="display:block"><img src="https://assets.example.invalid/banner.png"',
    );
    expect(emailDesignText('Hello', linked)).toContain(`An office: ${destination}`);
    expect(renderEmailHtml('Hello', design)).not.toContain('style="display:block"><img src="https://assets.example.invalid/banner.png"');
  });
  it('rejects unsafe URLs, unsupported fields and incomplete button or image descriptions', () => {
    for (const invalid of [
      { ...design, button_url: 'javascript:alert(1)' },
      { ...design, image_url: 'https://example.invalid/" onerror="evil' },
      { ...design, image_link_url: 'javascript:alert(1)' },
      { ...design, image_url: '', image_link_url: design.button_url },
      { ...design, image_alt: '' }, { ...design, button_label: '' },
      { ...design, accent_color: '#fff" style="background:red' },
      { ...design, extra: '<script>' },
    ]) {
      expect(emailDesignErrors(invalid).length).toBeGreaterThan(0);
      expect(() => renderEmailHtml('Hello', invalid)).toThrow();
    }
  });
  it('includes the approved branding in Gmail MIME and plain-text fallback', () => {
    const mime = agentMime({ to: 'qa@example.invalid', subject: 'Hello', body: 'Hello', emailDesign: design },
      'agent@example.invalid', 'Agent', '<design@example.invalid>');
    const part = (kind: string) => Buffer.from(mime.split(`Content-Type: text/${kind}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`)[1]!.split('\r\n--')[0]!, 'base64').toString();
    expect(part('html')).toContain('https://assets.example.invalid/banner.png');
    expect(part('plain')).toContain('Review options: https://example.invalid/review?a=1&b=2');
  });
  it('escapes untrusted markup, preserves paragraphs and links only HTTPS URLs', () => {
    const html = renderEmailHtml('Hi Sam,\n\n<svg onload="evil()">\njavascript:alert(1)\nhttps://example.invalid/quote?a=1&b=2.\n\n-- \nAgent\nhttps://www.shield-assurance.com');
    expect(html).not.toContain('<svg');
    expect(html).toContain('&lt;svg');
    expect(html).toContain('href="https://example.invalid/quote?a=1&amp;b=2"');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('border-top:1px solid');
    expect(html).toContain('href="https://www.shield-assurance.com"');
  });
  it('adds exactly one agency website link to authored and system signatures', () => {
    for (const body of [appendPersonalSignature('Hello', 'Agent\nAgency'), appendAgencySignature('Hello', 'system'),
      appendPersonalSignature('Hello\n\n-- \nExisting author\nwww.shield-assurance.com', 'Other author')]) {
      expect(ensureWebsiteLink(body)).toBe(body);
      expect(body.match(/https:\/\/www\.shield-assurance\.com/g)).toHaveLength(1);
    }
  });
  it.each([false, true])('uses a real multipart alternative with plain text, safe HTML and preserved attachments (%s)', (attachments) => {
    const mime = agentMime({ to: 'qa@example.invalid', subject: 'A quote', body: 'Hello\n\n-- \nAgent\nhttps://www.shield-assurance.com',
      ...(attachments ? { attachments: [{ filename: 'quote.pdf', content: Buffer.from('fixture').toString('base64'), type: 'application/pdf' }] } : {}) },
    'agent@example.invalid', 'Agent', '<fixture@example.invalid>');
    expect(mime).toContain('Content-Type: multipart/alternative');
    expect(mime).toContain('Content-Type: text/plain; charset=UTF-8');
    expect(mime).toContain('Content-Type: text/html; charset=UTF-8');
    expect(mime.includes('Content-Type: multipart/mixed')).toBe(attachments);
    if (attachments) expect(mime).toContain('filename="quote.pdf"');
    const html = mime.split('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1]!.split('\r\n--')[0]!;
    expect(Buffer.from(html.replace(/\r\n/g, ''), 'base64').toString()).toContain('href="https://www.shield-assurance.com"');
    expect(createHash('sha256').update(mime).digest('hex')).toHaveLength(64);
  });
});
