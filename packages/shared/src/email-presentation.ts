import { emailDesignText, parseEmailDesign, type EmailDesign } from './email-design.js';
import { emailDocumentHtml, emailDocumentText, emailRowsHtml, emailRowsText, parseEmailDocument, parseEmailRows, type EmailDocument, type EmailRow } from './email-document.js';
export const AGENCY_WEBSITE = 'https://www.shield-assurance.com';

export interface EmailFormatting {
  bodyDocument?: EmailDocument;
  signatureDocument?: EmailDocument;
  signatureRows?: EmailRow[];
}

export function emailPlainText(body: string, design?: EmailDesign, formatting: EmailFormatting = {}): string {
  const signature = body.search(/(?:^|\n)-- ?\n/);
  if (!formatting.signatureRows || signature < 0) return emailDesignText(body, design);
  const rows = parseEmailRows(formatting.signatureRows)!;
  const footer = body.slice(signature).replace(/^\n?-- ?\n/, '');
  return `${emailDesignText(body.slice(0, signature).trimEnd(), design)}\n\n-- \n${emailRowsText(rows, footer)}`;
}

export function ensureWebsiteLink(body: string): string {
  if (/https:\/\/(?:www\.)?shield-assurance\.com(?:[/?#]|\b)/i.test(body)) return body;
  if (/\b(?:www\.)?shield-assurance\.com\b/i.test(body)) {
    return body.replace(/\b(?:www\.)?shield-assurance\.com\b/i, AGENCY_WEBSITE);
  }
  return `${body.trimEnd()}\n${AGENCY_WEBSITE}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character] ?? character);
}

function linkedText(value: string): string {
  const parts = value.split(/(https:\/\/[^\s<>"']+)/g);
  return parts.map((part, index) => {
    if (index % 2 === 0) return escapeHtml(part).replace(/\n/g, '<br>');
    const url = part.replace(/[.,;!?)]*$/, '');
    return `<a href="${escapeHtml(url)}" style="color:#1681a5;text-decoration:underline">${escapeHtml(url)}</a>${escapeHtml(part.slice(url.length))}`;
  }).join('');
}

export function renderEmailHtml(body: string, value?: EmailDesign, formatting: EmailFormatting = {}): string {
  const design = parseEmailDesign(value);
  const normalized = body.replace(/\r\n/g, '\n').trim();
  const signature = normalized.search(/(?:^|\n)-- ?\n/);
  const message = signature < 0 ? normalized : normalized.slice(0, signature).trimEnd();
  const footer = signature < 0 ? '' : normalized.slice(signature).replace(/^\n?-- ?\n/, '');
  let paragraphs = message.split(/\n\s*\n/).map((paragraph) =>
    `<p style="margin:0 0 18px;line-height:1.65">${linkedText(paragraph)}</p>`).join('');
  const formatted = (text: string, value: EmailDocument | undefined): string | null => {
    const doc = parseEmailDocument(value);
    if (!doc) return null;
    const plain = emailDocumentText(doc).trim();
    if (!plain || !text.startsWith(plain)) throw new Error('Email formatting no longer matches the message. Review it before sending.');
    return emailDocumentHtml(doc) + (text.slice(plain.length).trim() ? `<p>${linkedText(text.slice(plain.length).trim())}</p>` : '');
  };
  paragraphs = formatted(message, formatting.bodyDocument) ?? paragraphs;
  let signatureHtml = formatted(footer, formatting.signatureDocument) ?? linkedText(footer);
  if (formatting.signatureRows) signatureHtml = emailRowsHtml(parseEmailRows(formatting.signatureRows)!, signatureHtml);
  if (design) {
    if (design.rows) return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:${design.background_color}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif"><tr><td>${emailRowsHtml(design.rows, paragraphs)}${footer ? `<div style="padding:24px;background:#ffffff">${signatureHtml}</div>` : ''}</td></tr></table></td></tr></table></body></html>`;
    const accent = design.accent_color;
    const rgb = [1, 3, 5].map((offset) => parseInt(accent.slice(offset, offset + 2), 16) / 255)
      .map((color) => color <= 0.04045 ? color / 12.92 : ((color + 0.055) / 1.055) ** 2.4);
    const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
    const buttonText = luminance > 0.179 ? '#000000' : '#ffffff';
    const logo = design.logo_url ? `<img src="${escapeHtml(design.logo_url)}" alt="${escapeHtml(design.brand_name)}" width="160" style="display:block;width:160px;max-width:100%;height:auto;border:0">` : escapeHtml(design.brand_name);
    const heading = design.heading ? `<h1 style="margin:0 0 24px;font-size:28px;line-height:1.25;color:#263238">${escapeHtml(design.heading)}</h1>` : '';
    const banner = design.image_url ? `<img src="${escapeHtml(design.image_url)}" alt="${escapeHtml(design.image_alt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0">` : '';
    const image = banner ? `<tr><td>${design.image_link_url ? `<a href="${escapeHtml(design.image_link_url)}" style="display:block">${banner}</a>` : banner}</td></tr>` : '';
    const button = design.button_url ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td bgcolor="${accent}" style="border-radius:4px"><a href="${escapeHtml(design.button_url)}" style="display:inline-block;padding:14px 24px;font-weight:bold;color:${buttonText};text-decoration:none">${escapeHtml(design.button_label)}</a></td></tr></table>` : '';
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:${design.background_color};color:#263238"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${design.background_color}"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:100%;max-width:600px;font-family:Arial,Helvetica,sans-serif;font-size:15px;border-top:6px solid ${accent}"><tr><td style="padding:24px 28px;color:${accent};font-size:20px;font-weight:bold" align="${design.layout === 'welcome' ? 'center' : 'left'}">${logo}</td></tr>${design.layout === 'announcement' ? image : ''}<tr><td style="padding:24px 28px">${heading}${paragraphs}${button}${footer ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #d8dfe5;font-size:13px;line-height:1.6">${signatureHtml}</div>` : ''}</td></tr>${design.layout !== 'announcement' ? image : ''}</table></td></tr></table></body></html>`;
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#fff;color:#263238"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td style="padding:24px 16px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;font-family:Arial,Helvetica,sans-serif;font-size:15px"><tr><td>${paragraphs}${footer ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #d8dfe5;color:#52616b;font-size:13px;line-height:1.6">${signatureHtml}</div>` : ''}</td></tr></table></td></tr></table></body></html>`;
}
