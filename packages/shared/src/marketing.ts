export const OUTREACH_TEMPLATES = {
  auto: { label: 'Choose from context', purpose: 'Use the latest request and relationship stage; ask for missing information when context is sparse.' },
  quote_response: { label: 'Inbound quote response', purpose: 'Answer the actual quote request. Acknowledge the requested insurance and ask only for the next missing detail. Never imply a quote is ready.' },
  missing_information: { label: 'Missing-information follow-up', purpose: 'Request the specific missing detail needed to progress. Do not ask again for information already supplied.' },
  renewal_review: { label: 'Renewal review', purpose: 'Offer a review around a recorded renewal date and stated priorities. If the date is unknown, ask for it; do not invent urgency.' },
  cross_sell: { label: 'Relevant coverage conversation', purpose: 'Discuss one recorded insurance interest or asset as a question, not an assumed coverage gap. No unsupported savings or bundle claims.' },
  reactivation: { label: 'Reconnect with a dormant lead', purpose: 'Reconnect respectfully around a recorded need. Ask whether it is still relevant; do not presume the person still wants a quote.' },
} as const;

export type OutreachTemplate = keyof typeof OUTREACH_TEMPLATES;
export function isOutreachTemplate(value: unknown): value is OutreachTemplate {
  return typeof value === 'string' && Object.hasOwn(OUTREACH_TEMPLATES, value);
}

export interface MarketingProfile {
  interests: string;
  priorities: string;
  objections: string;
  next_step: string;
  preferred_channel: 'unknown' | 'email' | 'phone' | 'sms';
  template: OutreachTemplate;
  source: string;
  confirmed_on: string;
}

export const EMPTY_MARKETING_PROFILE: MarketingProfile = {
  interests: '', priorities: '', objections: '', next_step: '',
  preferred_channel: 'unknown', template: 'auto', source: '', confirmed_on: '',
};

export interface OutreachSender {
  name: string;
  role: string;
  agency: string;
  service_area: string;
  specialties: string;
  tone: string;
  signature: string;
  approved_claims: string;
}

export const DEFAULT_OUTREACH_SENDER: OutreachSender = {
  name: 'Chance', role: 'Insurance producer', agency: 'Shield Assurance',
  service_area: 'Tucson, Arizona', specialties: '', tone: 'Direct, warm, professional; no hype.',
  signature: 'Chance\nShield Assurance', approved_claims: '',
};
