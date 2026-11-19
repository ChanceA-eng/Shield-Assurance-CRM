export const EMAIL_FONTS = ['Arial', 'Verdana', 'Georgia', 'Times New Roman', 'Tahoma', 'Trebuchet MS'] as const;
export interface EmailTextNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  content?: EmailTextNode[];
}
export interface EmailDocument extends EmailTextNode { type: 'doc' }
export interface EmailBlock {
  id: string;
  type: 'text' | 'body' | 'image' | 'button' | 'divider' | 'spacer';
  document?: EmailDocument;
  url?: string;
  href?: string;
  text?: string;
  alt?: string;
  color: string;
  background: string;
  padding: number;
  border: number;
  radius: number;
  align: 'left' | 'center' | 'right';
}
export interface EmailRow {
  id: string;
  columns: EmailBlock[][];
  background: string;
}

export function emailContentKey(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
}

export function emailEscape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const emailColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export function emailLink(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2000 || /[\s<>"'{}\\]/.test(value)) return false;
  try { const url = new URL(value); return ['https:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
const https = (value: unknown): value is string => emailLink(value) && value.startsWith('https://');
const align = (value: unknown): boolean => ['left', 'center', 'right', 'justify'].includes(String(value));
const range = (value: unknown, min: number, max: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const allowed = (value: Record<string, unknown>, fields: string[]): boolean => Object.keys(value).every((key) => fields.includes(key));

export function parseEmailDocument(value: unknown): EmailDocument | undefined {
  if (value === undefined || value === null) return undefined;
  if (!record(value) || value.type !== 'doc' || JSON.stringify(value).length > 100000) throw new Error('Email formatting is too large or invalid.');
  let count = 0;
  const check = (node: unknown, depth: number): node is EmailTextNode => {
    if (++count > 3000 || depth > 12 || !record(node) || typeof node.type !== 'string'
      || !allowed(node, ['type', 'text', 'attrs', 'marks', 'content'])) return false;
    if (!['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'horizontalRule'].includes(node.type)) return false;
    if (node.type === 'doc' && depth !== 0) return false;
    if (node.type === 'text' && (typeof node.text !== 'string' || !node.text || node.content !== undefined)) return false;
    if (['hardBreak', 'horizontalRule'].includes(node.type) && node.content !== undefined) return false;
    if (node.text !== undefined && (node.type !== 'text' || typeof node.text !== 'string')) return false;
    if (node.attrs !== undefined) {
      if (!record(node.attrs) || !allowed(node.attrs, ['textAlign', 'level', 'start', 'type'])) return false;
      if (node.attrs.textAlign != null && !align(node.attrs.textAlign)) return false;
      if (node.attrs.level != null && !range(node.attrs.level, 1, 3)) return false;
      if (node.attrs.start != null && !range(node.attrs.start, 1, 999)) return false;
      if (node.attrs.type != null && node.attrs.type !== null && node.attrs.type !== '1') return false;
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 8) return false;
      for (const mark of node.marks) {
        if (!record(mark) || !['bold', 'italic', 'underline', 'strike', 'link', 'textStyle'].includes(String(mark.type))
          || !allowed(mark, ['type', 'attrs'])) return false;
        if (mark.attrs !== undefined) {
          if (!record(mark.attrs)) return false;
          if (mark.type === 'link') {
            if (!allowed(mark.attrs, ['href', 'target', 'rel', 'class']) || !emailLink(mark.attrs.href)) return false;
          } else if (mark.type === 'textStyle') {
            if (!allowed(mark.attrs, ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'lineHeight'])) return false;
            for (const key of ['color', 'backgroundColor']) if (mark.attrs[key] != null && !emailColor(mark.attrs[key])) return false;
            if (mark.attrs.fontFamily != null && !EMAIL_FONTS.includes(mark.attrs.fontFamily as typeof EMAIL_FONTS[number])) return false;
            if (mark.attrs.fontSize != null && !/^(?:[89]|[1-5]\d|6[0-4])px$/.test(String(mark.attrs.fontSize))) return false;
            if (mark.attrs.lineHeight != null && !['1', '1.2', '1.5', '1.8', '2'].includes(String(mark.attrs.lineHeight))) return false;
          } else if (Object.keys(mark.attrs).length) return false;
        } else if (mark.type === 'link') return false;
      }
    }
    return node.content === undefined || (Array.isArray(node.content) && node.content.every((child) => check(child, depth + 1)));
  };
  if (!check(value, 0)) throw new Error('This email contains unsupported formatting, fonts, or links.');
  const attributes = (attrs: Record<string, unknown>) => Object.fromEntries(Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b)));
  const normalize = (node: EmailTextNode): EmailTextNode => ({
    type: node.type,
    ...(node.text !== undefined ? { text: node.text } : {}),
    ...(node.attrs ? { attrs: attributes(node.attrs) } : {}),
    ...(node.marks ? { marks: node.marks.map((mark) => ({ type: mark.type, ...(mark.attrs ? { attrs: attributes(mark.attrs) } : {}) })) } : {}),
    ...(node.content ? { content: node.content.map(normalize) } : {}),
  });
  return { ...normalize(value), type: 'doc' };
}

export function documentFromText(text: string): EmailDocument {
  return { type: 'doc', content: text.split('\n').map((line) => ({
    type: 'paragraph', ...(line ? { content: [{ type: 'text', text: line }] } : {}),
  })) };
}
export function emailDocumentText(doc: EmailDocument): string {
  const visit = (node: EmailTextNode): string => {
    if (node.type === 'text') {
      const link = node.marks?.find((mark) => mark.type === 'link')?.attrs?.href;
      return (node.text ?? '') + (typeof link === 'string' && link !== node.text ? ` (${link})` : '');
    }
    if (node.type === 'hardBreak' || node.type === 'horizontalRule') return '\n';
    const text = node.content?.map(visit).join('') ?? '';
    return ['paragraph', 'heading', 'listItem', 'blockquote'].includes(node.type) ? `${text}\n` : text;
  };
  return visit(doc).trimEnd();
}
export function emailDocumentHtml(value: EmailDocument): string {
  const doc = parseEmailDocument(value)!;
  const visit = (node: EmailTextNode): string => {
    if (node.type === 'text') {
      let text = emailEscape(node.text ?? '');
      for (const mark of node.marks ?? []) {
        const attrs = mark.attrs ?? {};
        if (mark.type === 'link') text = `<a href="${emailEscape(String(attrs.href))}" style="color:inherit;text-decoration:underline">${text}</a>`;
        else if (mark.type === 'textStyle') {
          const css = Object.entries(attrs).filter(([, v]) => v != null).map(([k, v]) =>
            `${({ color: 'color', backgroundColor: 'background-color', fontFamily: 'font-family', fontSize: 'font-size', lineHeight: 'line-height' })[k]}:${v}`).join(';');
          text = `<span style="${emailEscape(css)}">${text}</span>`;
        } else {
          const tag = ({ bold: 'strong', italic: 'em', underline: 'u', strike: 's' })[mark.type];
          if (tag) text = `<${tag}>${text}</${tag}>`;
        }
      }
      return text;
    }
    if (node.type === 'hardBreak') return '<br>';
    if (node.type === 'horizontalRule') return '<hr style="border:0;border-top:1px solid #d8dfe5">';
    const children = node.content?.map(visit).join('') ?? '';
    if (node.type === 'doc') return children;
    if (node.type === 'heading') return `<h${node.attrs?.level ?? 2} style="margin:0 0 12px;text-align:${node.attrs?.textAlign ?? 'left'}">${children}</h${node.attrs?.level ?? 2}>`;
    if (node.type === 'paragraph') return `<p style="margin:0 0 10px;line-height:1.6;text-align:${node.attrs?.textAlign ?? 'left'}">${children || '<br>'}</p>`;
    const tag = ({ bulletList: 'ul', orderedList: 'ol', listItem: 'li', blockquote: 'blockquote' })[node.type];
    return tag ? `<${tag}>${children}</${tag}>` : children;
  };
  return visit(doc);
}

export function parseEmailRows(value: unknown): EmailRow[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 30 || JSON.stringify(value).length > 100000) throw new Error('Use 1–30 rows and a design under 100 KB.');
  const ids = new Set<string>();
  const id = (v: unknown): boolean => typeof v === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(v) && !ids.has(v) && !!ids.add(v);
  let bodies = 0;
  for (const row of value) {
    if (!record(row) || !allowed(row, ['id', 'columns', 'background']) || !id(row.id) || !emailColor(row.background)
      || !Array.isArray(row.columns) || row.columns.length < 1 || row.columns.length > 3) throw new Error('Choose a valid row with 1–3 columns.');
    for (const column of row.columns) {
      if (!Array.isArray(column) || column.length > 15) throw new Error('Use up to 15 blocks per column.');
      for (const block of column) {
        if (!record(block) || !allowed(block, ['id', 'type', 'document', 'url', 'href', 'text', 'alt', 'color', 'background', 'padding', 'border', 'radius', 'align'])
          || !id(block.id) || !['text', 'body', 'image', 'button', 'divider', 'spacer'].includes(String(block.type))
          || !emailColor(block.color) || !emailColor(block.background) || !range(block.padding, 0, 60)
          || !range(block.border, 0, 8) || !range(block.radius, 0, 40) || !['left', 'center', 'right'].includes(String(block.align))) throw new Error('This design contains an invalid block or style.');
        if (block.type === 'body') bodies++;
        if (block.type !== 'text' && block.document !== undefined) throw new Error('Only text blocks can contain formatted text.');
        if (block.href !== undefined && typeof block.href !== 'string') throw new Error('Enter a valid block destination.');
        for (const field of ['url', 'alt', 'text']) if (block[field] !== undefined && typeof block[field] !== 'string') throw new Error('Block labels and image addresses must be text.');
        if (block.type === 'text' && !parseEmailDocument(block.document)) throw new Error('Add text to the block.');
        if (block.type === 'image' && (!https(block.url) || typeof block.alt !== 'string' || !block.alt.trim() || block.alt.length > 200)) throw new Error('Upload an image and describe it.');
        if (block.href && !emailLink(block.href)) throw new Error('Enter a valid HTTPS, email, or telephone link.');
        if (block.type === 'button' && (!emailLink(block.href) || typeof block.text !== 'string' || !block.text.trim() || block.text.length > 100)) throw new Error('Add a button label and destination.');
      }
    }
  }
  if (bodies !== 1) throw new Error('Keep exactly one message body block so each email includes its personalized message.');
  return (value as EmailRow[]).map((row) => ({
    id: row.id, background: row.background, columns: row.columns.map((column) => column.map((block) => ({
      id: block.id, type: block.type, color: block.color, background: block.background,
      padding: block.padding, border: block.border, radius: block.radius, align: block.align,
      ...(block.document ? { document: parseEmailDocument(block.document) } : {}),
      ...(block.url !== undefined ? { url: block.url } : {}),
      ...(block.href !== undefined ? { href: block.href } : {}),
      ...(block.text !== undefined ? { text: block.text } : {}),
      ...(block.alt !== undefined ? { alt: block.alt } : {}),
    }))),
  }));
}

export function emailRowsHtml(rows: EmailRow[], bodyHtml: string): string {
  return rows.map((row) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${row.background};table-layout:fixed"><tr>${
    row.columns.map((column) => `<td valign="top" width="${100 / row.columns.length}%" style="word-break:break-word">${
      column.map((block) => {
        let content = '';
        if (block.type === 'body') content = bodyHtml;
        if (block.type === 'text' && block.document) content = emailDocumentHtml(block.document);
        if (block.type === 'button') content = `<a href="${emailEscape(block.href!)}" style="display:inline-block;padding:12px 20px;color:${block.color};background:${block.background};border-radius:${block.radius}px;text-decoration:none;font-weight:bold">${emailEscape(block.text!)}</a>`;
        if (block.type === 'image') {
          content = `<img src="${emailEscape(block.url!)}" alt="${emailEscape(block.alt!)}" width="${Math.floor(600 / row.columns.length)}" style="display:block;width:100%;height:auto;border:0;border-radius:${block.radius}px">`;
          if (block.href) content = `<a href="${emailEscape(block.href)}">${content}</a>`;
        }
        if (block.type === 'divider') content = `<hr style="border:0;border-top:1px solid ${block.color}">`;
        if (block.type === 'spacer') content = '<div style="height:16px;line-height:16px">&nbsp;</div>';
        return `<div style="padding:${block.padding}px;text-align:${block.align};color:${block.color};background:${block.background};border:${block.border}px solid ${block.color};border-radius:${block.radius}px">${content}</div>`;
      }).join('')
    }</td>`).join('')
  }</tr></table>`).join('');
}
export function emailRowsText(rows: EmailRow[], body: string): string {
  return rows.flatMap((row) => row.columns.flatMap((col) => col.map((block) => {
    if (block.type === 'body') return body;
    if (block.type === 'text' && block.document) return emailDocumentText(block.document);
    if (block.type === 'button') return `${block.text}: ${block.href}`;
    if (block.type === 'image') return block.href ? `${block.alt}: ${block.href}` : block.alt;
    return '';
  }))).filter(Boolean).join('\n\n');
}
