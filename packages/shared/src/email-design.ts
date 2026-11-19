import { parseEmailRows, emailRowsText, type EmailRow } from './email-document.js';

export interface EmailDesign {
  layout: 'letter' | 'welcome' | 'announcement';
  brand_name: string;
  accent_color: string;
  background_color: string;
  logo_url: string;
  image_url: string;
  image_alt: string;
  image_link_url?: string;
  heading: string;
  button_label: string;
  button_url: string;
  rows?: EmailRow[];
}

export interface SalesTemplateSnapshot {
  id: string;
  revision: number;
  email_design?: EmailDesign;
}

export const DEFAULT_EMAIL_DESIGN: EmailDesign = {
  layout: 'letter', brand_name: '', accent_color: '#1681a5', background_color: '#f3f5f7',
  logo_url: '', image_url: '', image_alt: '', heading: '', button_label: '', button_url: '',
};

export function isEmailDesignUrl(value: string): boolean {
  if (!value || value.length > 2000 || /[\s<>"'{}\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname);
  } catch { return false; }
}

export function emailDesignErrors(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) return ['Choose a valid email design.'];
  const design = value as Record<string, unknown>;
  const errors: string[] = [];
  try { parseEmailRows(design.rows); } catch (error) { errors.push(error instanceof Error ? error.message : 'Invalid email rows.'); }
  if (!['letter', 'welcome', 'announcement'].includes(String(design.layout))) errors.push('Choose an email layout.');
  for (const [field, limit] of Object.entries({ brand_name: 100, heading: 200, image_alt: 200, button_label: 80 })) {
    if (typeof design[field] !== 'string' || design[field].length > limit || /[{}]/.test(design[field])) {
      errors.push(`${field.replace(/_/g, ' ')} must be text of at most ${limit} characters without merge fields.`);
    }
  }
  for (const field of ['accent_color', 'background_color']) {
    if (typeof design[field] !== 'string' || !/^#[0-9a-f]{6}$/i.test(design[field])) errors.push('Choose a six-digit hex color.');
  }
  for (const field of ['logo_url', 'image_url', 'button_url']) {
    if (typeof design[field] !== 'string' || (design[field] !== '' && !isEmailDesignUrl(design[field]))) {
      errors.push(`${field.replace(/_/g, ' ')} must be a public HTTPS link.`);
    }
  }
  if (design.logo_url && typeof design.brand_name === 'string' && !design.brand_name.trim()) errors.push('Add a brand name for the logo description.');
  if (design.image_link_url !== undefined && design.image_link_url !== '') {
    if (typeof design.image_link_url !== 'string' || !isEmailDesignUrl(design.image_link_url)) errors.push('The banner destination must be an HTTPS link.');
    if (!design.image_url) errors.push('Add a banner image before setting a banner destination.');
  }
  if (design.image_url && typeof design.image_alt === 'string' && !design.image_alt.trim()) errors.push('Describe the banner image for readers who cannot see it.');
  if (Boolean(typeof design.button_label === 'string' && design.button_label.trim()) !== Boolean(design.button_url)) errors.push('Provide both a button label and its link, or leave both blank.');
  if (Object.keys(design).some((key) => key !== 'rows' && key !== 'image_link_url' && !Object.prototype.hasOwnProperty.call(DEFAULT_EMAIL_DESIGN, key))) {
    errors.push('The email design contains unsupported fields.');
  }
  return errors;
}

export function parseEmailDesign(value: unknown): EmailDesign | undefined {
  const errors = emailDesignErrors(value);
  if (errors.length) throw new Error(errors.join(' '));
  if (value === undefined || value === null) return undefined;
  const design = value as EmailDesign;
  return {
    layout: design.layout, brand_name: design.brand_name, accent_color: design.accent_color,
    background_color: design.background_color, logo_url: design.logo_url, image_url: design.image_url,
    image_alt: design.image_alt, ...(design.image_link_url ? { image_link_url: design.image_link_url } : {}),
    heading: design.heading, button_label: design.button_label, button_url: design.button_url,
    ...(design.rows ? { rows: parseEmailRows(design.rows) } : {}),
  };
}

export function emailDesignText(body: string, value?: EmailDesign): string {
  const design = parseEmailDesign(value);
  if (!design) return body;
  const signature = body.search(/(?:^|\n)-- ?\n/);
  const message = signature < 0 ? body : body.slice(0, signature).trimEnd();
  const footer = signature < 0 ? '' : body.slice(signature).replace(/^\n+/, '');
  if (design.rows) return [emailRowsText(design.rows, message), footer].filter(Boolean).join('\n\n');
  return [design.brand_name, design.heading, message,
    design.image_link_url && design.image_link_url !== design.button_url ? `${design.image_alt}: ${design.image_link_url}` : '',
    design.button_url ? `${design.button_label}: ${design.button_url}` : '', footer].filter(Boolean).join('\n\n');
}
