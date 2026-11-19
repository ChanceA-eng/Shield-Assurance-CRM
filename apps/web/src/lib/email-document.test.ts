import { describe, expect, it } from 'vitest';
import { DEFAULT_EMAIL_DESIGN, documentFromText, emailDocumentHtml, emailDocumentText, emailRowsHtml,
  emailDesignText, emailPlainText, parseEmailDocument, parseEmailRows, renderEmailHtml, type EmailBlock, type EmailDocument, type EmailRow } from '@crm/shared';
import { messageDocument } from './email-formatting';

const signature: EmailDocument = { type: 'doc', content: [{ type: 'paragraph', content: [
  { type: 'text', text: 'Jane', marks: [{ type: 'bold' }] },
] }] };
const block = (id: string, type: EmailBlock['type']): EmailBlock => ({
  id, type, color: '#263238', background: '#ffffff', padding: 12, border: 0, radius: 4, align: 'left',
});
const rows = (): EmailRow[] => [{ id: 'row', background: '#ffffff', columns: [
  [block('body', 'body')], [{ ...block('cta', 'button'), text: 'Get a quote', href: 'https://example.test/quote' }],
] }];

describe('email-safe rich documents and layouts', () => {
  it('renders only supported formatting, escapes text, and keeps plaintext links', () => {
    const doc: EmailDocument = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [
      { type: 'text', text: '<Quote>', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.test' } }] },
    ] }] };
    expect(emailDocumentHtml(doc)).toContain('<strong>&lt;Quote&gt;</strong>');
    expect(emailDocumentText(doc)).toBe('<Quote> (https://example.test)');
    expect(emailDocumentHtml(doc)).toContain('text-align:center');
  });
  it.each([
    { type: 'doc', content: [{ type: 'script', text: 'alert(1)' }] },
    { type: 'doc', content: [{ type: 'text', text: 'go', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] },
    { type: 'doc', content: [{ type: 'text', text: 'go', marks: [{ type: 'textStyle', attrs: { color: 'red;background:url(https://bad.test)' } }] }] },
    { type: 'doc', content: [{ type: 'doc', content: [] }] },
    { type: 'doc', content: [{ type: 'text', text: 42 }] },
  ])('rejects unsafe or malformed document %#', (input) => {
    expect(() => parseEmailDocument(input)).toThrow();
  });
  it('retains rich signatures in plain, fixed and custom-layout emails, plus appended links', () => {
    for (const design of [undefined, DEFAULT_EMAIL_DESIGN, { ...DEFAULT_EMAIL_DESIGN, rows: rows() }]) {
      const html = renderEmailHtml('Hello\n\n-- \nJane\n\nhttps://example.test/file', design, {
        bodyDocument: documentFromText('Hello'), signatureDocument: signature,
      });
      expect(html).toContain('<strong>Jane</strong>');
      expect(html).toContain('href="https://example.test/file"');
    }
  });
  it('does not silently send formatting for different message text', () => {
    expect(() => messageDocument(signature, 'Different')).toThrow('no longer matches');
    expect(() => renderEmailHtml('Different', undefined, { bodyDocument: signature })).toThrow();
    expect(messageDocument(signature, 'Jane')).toEqual(signature);
  });
  it('renders rows as tables and carries button destinations into plaintext', () => {
    const layout = parseEmailRows(rows())!;
    expect(emailRowsHtml(layout, '<p>Personalized</p>')).toContain('<td valign="top" width="50%"');
    expect(emailDesignText('Hello', { ...DEFAULT_EMAIL_DESIGN, rows: layout })).toContain('Get a quote: https://example.test/quote');
    expect(() => parseEmailRows([{ ...layout[0], columns: [[block('a', 'body'), block('b', 'body')]] }])).toThrow('exactly one');
    expect(() => parseEmailRows([{ ...layout[0], columns: [[{ ...block('a', 'body'), href: { unsafe: true } }]] }])).toThrow();
    expect(emailPlainText('Hello\n\n-- \nJane', undefined, { signatureRows: layout }))
      .toContain('Get a quote: https://example.test/quote');
  });
});
