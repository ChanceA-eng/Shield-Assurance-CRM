import type { OutreachSender } from './marketing.js';
import { emailDesignErrors, type EmailDesign } from './email-design.js';
import type { EmailFormatting } from './email-presentation.js';

export const SALES_CATEGORIES = ['First contact', 'Appointments', 'Information', 'Quotes', 'Closing', 'Reconnect'] as const;
export type SalesCategory = typeof SALES_CATEGORIES[number];
export const SALES_FIELDS = ['contact_name', 'business_name', 'agent_name', 'agency_name', 'insurance_interest',
  'next_step', 'appointment_details', 'quote_link', 'quote_summary', 'binding_requirements',
  'prospecting_signal', 'specific_offer'] as const;
export type SalesField = typeof SALES_FIELDS[number];
export type SalesFacts = Partial<Record<SalesField, string>>;
export interface SalesTemplate {
  id: string;
  name: string;
  category: SalesCategory;
  subject: string;
  email_body: string;
  sms_body: string;
  revision: number;
  archived: boolean;
  builtin: boolean;
  email_design?: EmailDesign;
}

function starter(id: string, name: string, category: SalesCategory, subject: string, email: string, sms: string): SalesTemplate {
  return { id, name, category, subject, email_body: email, sms_body: sms, revision: 0, archived: false, builtin: true };
}
export const SALES_TEMPLATES: readonly SalesTemplate[] = [
  starter('inquiry_response', 'First response to an inquiry', 'First contact', 'About your {{insurance_interest}} request',
    'Hi {{contact_name}},\n\nI have your request about {{insurance_interest}}. I do not want to send a broad overview before I understand what you need it to answer.\n\nWhat decision or requirement are you trying to resolve? One sentence is enough; I will keep the next step focused on that.',
    'Hi {{contact_name}}, I have your {{insurance_interest}} request. What decision or requirement are you trying to resolve? - {{agent_name}}, {{agency_name}}'),
  starter('introduction', 'Agent introduction - touch 1', 'First contact', 'A question about {{insurance_interest}}',
    'Hi {{contact_name}},\n\nI am {{agent_name}} with {{agency_name}}. I understand {{insurance_interest}} may be relevant to you.\n\nWhat would you most want to know about it?\n\nA quick reply is fine.',
    'Hi {{contact_name}}, {{agent_name}} at {{agency_name}} here. For {{insurance_interest}}, what decision or requirement are you trying to resolve?'),
  starter('cold_first_touch_evidence', 'Cold prospect - specific first touch', 'First contact', 'A quick question about your operation',
    'Hi {{contact_name}},\n\nI am {{agent_name}} with {{agency_name}}. I noticed {{prospecting_signal}}.\n\nWould {{specific_offer}} be useful?',
    'Hi {{contact_name}}, I am {{agent_name}} with {{agency_name}}. I noticed {{prospecting_signal}}. Would {{specific_offer}} be useful?'),
  starter('cold_first_touch_question', 'Cold prospect - no verified business detail', 'First contact', 'A question about your insurance priorities',
    'Hi {{contact_name}},\n\nI am {{agent_name}} with {{agency_name}}.\n\nWhat is one insurance question you have about your business?',
    'Hi {{contact_name}}, I am {{agent_name}} with {{agency_name}}. What is one insurance question you have about your business?'),
  starter('contact_second_followup', 'Prospecting - touch 2: identify the priority', 'First contact', 'What would make a review worthwhile?',
    'Hi {{contact_name}},\n\nI wanted to ask about {{insurance_interest}}.\n\nWhat matters most to you: price, coverage terms, or a specific requirement?\n\nA few words will help me understand where to start.',
    'Hi {{contact_name}}, for {{insurance_interest}}, which matters most: price, coverage terms, or a specific requirement? - {{agent_name}}, {{agency_name}}'),
  starter('contact_third_followup', 'Prospecting - touch 3: offer a useful comparison', 'First contact', 'Compare more than the premium',
    'Hi {{contact_name}},\n\nFor {{insurance_interest}}, the deductible and exclusions can matter as much as the price.\n\nI can put together a short list of points to compare.\n\nWould that be useful?',
    'Hi {{contact_name}}, I can share a short list of points to compare for {{insurance_interest}}. Would that be useful? - {{agent_name}}'),
  starter('contact_fourth_followup', 'Prospecting - touch 4: find the decision-maker', 'First contact', 'The right person for this review',
    'Hi {{contact_name}},\n\nI have a question about {{insurance_interest}}.\n\nAre you the right person to ask, or does someone else handle that?\n\nA name or role would help.',
    'Hi {{contact_name}}, are you the right person to discuss {{insurance_interest}}? If not, who handles the review? - {{agent_name}}, {{agency_name}}'),
  starter('contact_fifth_followup', 'Prospecting - touch 5: establish timing', 'First contact', 'Useful now, or another month?',
    'Hi {{contact_name}},\n\nI wanted to ask about the timing for {{insurance_interest}}.\n\nWould a review be useful now or later?\n\nIf later, a month works.',
    'Hi {{contact_name}}, when would a {{insurance_interest}} review be useful: now, another month, or no follow-up? - {{agent_name}}, {{agency_name}}'),
  starter('contact_sixth_followup', 'Prospecting - touch 6: permission to close', 'First contact', 'Keep the conversation open?',
    'Hi {{contact_name}},\n\nI will leave {{insurance_interest}} with you for now.\n\nWould you like me to reconnect at another time?\n\nIf not, I will close the conversation.',
    'Hi {{contact_name}}, for {{insurance_interest}}: reply "review", a better month, or "close" so I know your preference. - {{agent_name}}, {{agency_name}}'),
  starter('missed_call', 'Called but unable to reach', 'First contact', 'Finding a convenient time',
    'Hi {{contact_name}},\n\nI tried calling about {{insurance_interest}}.\n\nWould you prefer email or a call at another time?\n\nIf a call works, let me know when.',
    'Hi {{contact_name}}, I tried calling about {{insurance_interest}}. Prefer email, or a call at a time you choose? - {{agent_name}}, {{agency_name}}'),
  starter('voicemail', 'Follow up after leaving voicemail', 'First contact', 'Following up on my voicemail',
    'Hi {{contact_name}},\n\nI left you a voicemail about {{insurance_interest}}.\n\nWhat would you most want a review to address: cost, coverage, or another concern?',
    'Hi {{contact_name}}, I left a voicemail about {{insurance_interest}}. What should we focus on: cost, coverage, or a requirement? - {{agent_name}}'),
  starter('appointment_confirmation', 'Appointment confirmation', 'Appointments', 'Our appointment',
    'Hi {{contact_name}},\n\nOur appointment is set for: {{appointment_details}}.\n\nMy goal is to leave you with a clearer understanding of your options and an agreed next step, not just another quote to sort through.\n\nWhat is the one question you most want answered during our conversation?\n\nReply with it and I can prepare around your priority.',
    'Hi {{contact_name}}, confirming {{appointment_details}}. What one question should we focus on? - {{agent_name}}, {{agency_name}}'),
  starter('appointment_reminder', 'Appointment reminder', 'Appointments', 'Reminder: our appointment',
    'Hi {{contact_name}},\n\nA quick reminder of our appointment: {{appointment_details}}.\n\nWe will use the time to work through your questions and identify the next step. You do not need to make a decision before the terms and requirements are clear.\n\nDoes that time still work?\n\nReply "confirmed", or suggest a better time if your schedule has changed.',
    'Hi {{contact_name}}, reminder: {{appointment_details}}. Reply "confirmed" or suggest a better time. - {{agent_name}}, {{agency_name}}'),
  starter('appointment_missed', 'Missed appointment / reschedule', 'Appointments', 'Would you like to reschedule?',
    'Hi {{contact_name}},\n\nWe did not connect for our appointment. Schedules change, and I do not want that to make it harder to get your questions answered.\n\nWould you prefer to reschedule, handle the next step by email, or pause the review?\n\nReply with whichever works best. If you choose a new time, please include your time zone so we can confirm the details.',
    'Hi {{contact_name}}, we missed our appointment. Prefer a new time, email, or to pause? - {{agent_name}}, {{agency_name}}'),
  starter('meeting_recap', 'After appointment - follow-up 1: agreed next step', 'Appointments', 'Turning our conversation into the next step',
    'Hi {{contact_name}},\n\nThank you for our conversation. The next step we agreed on is:\n\n{{next_step}}\n\nI want to keep this focused so you are not left figuring out what to do next.\n\nDoes that still match your plan?\n\nReply "yes" to confirm, or tell me what needs to change before we move ahead.',
    'Hi {{contact_name}}, our agreed next step is {{next_step}}. Does that still match your plan? - {{agent_name}}, {{agency_name}}'),
  starter('meeting_second_followup', 'After appointment - follow-up 2: remove a blocker', 'Appointments', 'What is holding up the next step?',
    'Hi {{contact_name}},\n\nWe discussed this next step: {{next_step}}.\n\nBefore I repeat the request, I want to understand whether something is in the way. It may be a question about the process, information you are still gathering, or simply the timing.\n\nWhich is the main blocker?\n\nA brief reply will help me address the right issue instead of sending another reminder.',
    'Hi {{contact_name}}, what is blocking {{next_step}}: a question, missing information, or timing? - {{agent_name}}, {{agency_name}}'),
  starter('meeting_third_followup', 'After appointment - follow-up 3: simplify the work', 'Appointments', 'Make the next step easier',
    'Hi {{contact_name}},\n\nThe next step from our conversation was: {{next_step}}.\n\nIf it feels like too much to work through at once, we can identify the first item rather than trying to finish the entire review in one exchange. I can also clarify what is actually required before you spend time gathering it.\n\nWould a short checklist make this easier?\n\nReply "checklist" and I will break down the next step.',
    'Hi {{contact_name}}, would a short checklist help with {{next_step}}? Reply "checklist". - {{agent_name}}, {{agency_name}}'),
  starter('meeting_fourth_followup', 'After appointment - follow-up 4: revisit the priority', 'Appointments', 'Does the original plan still fit?',
    'Hi {{contact_name}},\n\nOur agreed plan was: {{next_step}}.\n\nA useful review should match what matters to you now, not just what we discussed earlier. If your budget, requirements or priorities have shifted, it is better to adjust the plan than push ahead with the wrong next step.\n\nIs that still the right next step, or has your priority changed?\n\nA sentence is enough to point me in the right direction.',
    'Hi {{contact_name}}, is {{next_step}} still the right plan, or has your priority changed? - {{agent_name}}, {{agency_name}}'),
  starter('meeting_fifth_followup', 'After appointment - follow-up 5: agree on timing', 'Appointments', 'A realistic time to pick this up',
    'Hi {{contact_name}},\n\nI do not want to keep asking about {{next_step}} if it does not fit your schedule right now.\n\nWhat timing works better: this week, a later month, or a pause?\n\nA reply with your preference is enough. We can use that to plan the next conversation, then verify any current terms or requirements before you make a decision.',
    'Hi {{contact_name}}, for {{next_step}}, is this week, a later month, or a pause better? - {{agent_name}}, {{agency_name}}'),
  starter('meeting_sixth_followup', 'After appointment - follow-up 6: close with permission', 'Appointments', 'Continue our plan or close it for now?',
    'Hi {{contact_name}},\n\nWe spoke about {{next_step}}, but I have not heard back on how you want to proceed. I do not want to assume that your plans are unchanged.\n\nShould we continue, reconnect at a time you choose, or close the review for now?\n\nA short reply is all I need to understand your preference. If you return to it later, we can recheck the information rather than rely on old assumptions.',
    'Hi {{contact_name}}, should we continue with {{next_step}}, reconnect later, or close the review? - {{agent_name}}, {{agency_name}}'),
  starter('information_request', 'Missing-information request', 'Information', 'Information for the next step',
    'Hi {{contact_name}},\n\nTo take the next step, we need:\n\n{{next_step}}\n\nGetting the right information now helps us avoid comparing options based on incomplete details. Please do not email sensitive personal or payment information; we can arrange an appropriate way to provide it.\n\nCan you provide these items, or is one difficult to obtain?\n\nTell me which item needs help rather than waiting until you have everything.',
    'Hi {{contact_name}}, we need {{next_step}}. Can you provide it, or is an item difficult to obtain? Do not text sensitive details. - {{agent_name}}'),
  starter('quote_preparation', 'Quote preparation / status', 'Quotes', 'Your quote review',
    'Hi {{contact_name}},\n\nFor your {{insurance_interest}} review, the next step is:\n\n{{next_step}}\n\nI want the options we review to reflect your actual requirements, not assumptions. I will confirm available terms before presenting them as something you can choose.\n\nHas anything changed in your requirements or timing since your request?\n\nA quick update now helps us keep the review relevant.',
    'Hi {{contact_name}}, next for {{insurance_interest}}: {{next_step}}. Have your requirements or timing changed? - {{agent_name}}, {{agency_name}}'),
  starter('quote_delivery', 'Quote ready / delivery', 'Quotes', 'Your quote for review',
    'Hi {{contact_name}},\n\nYour quote is ready to review: {{quote_link}}\n\nHere is the summary:\n{{quote_summary}}\n\nPlease compare the limits, deductible and exclusions as well as the price. A quote is not confirmation of bound coverage; current terms and binding requirements must be verified before proceeding.\n\nWhat would you like to do next: review the terms together, request a change, or discuss the requirements to proceed?\n\nReply "review", "change" or "next steps".',
    'Hi {{contact_name}}, quote: {{quote_link}}. Reply "review", "change" or "next steps". A quote does not bind coverage. - {{agent_name}}, {{agency_name}}'),
  starter('quote_first_followup', 'After quote - follow-up 1: get a first reaction', 'Quotes', 'Your first reaction to the quote',
    'Hi {{contact_name}},\n\nNow that we have shared the quote, I would like to understand your reaction before suggesting the next step.\n\nIs the main question the price, the coverage terms, or how it compares with another option?\n\nReply with whichever matters most. I can work through that point with you, rather than ask you to make a decision on a quote that still needs explaining.',
    'Hi {{contact_name}}, what is your main question about the quote: price, coverage, or comparison? - {{agent_name}}, {{agency_name}}'),
  starter('quote_second_followup', 'After quote - follow-up 2: compare the trade-offs', 'Quotes', 'Put the options on the same footing',
    'Hi {{contact_name}},\n\nIf you are comparing the quote with another option, the most useful comparison is not just the premium. Limits, deductibles, exclusions and payment terms can change what you are actually choosing.\n\nWould a side-by-side explanation help you decide?\n\nReply "compare" and we can identify the details needed. There is no need to send sensitive documents by ordinary email.',
    'Hi {{contact_name}}, would a side-by-side comparison of quote terms help? Reply "compare". - {{agent_name}}, {{agency_name}}'),
  starter('quote_third_followup', 'After quote - follow-up 3: uncover the objection', 'Quotes', 'What would need to change?',
    'Hi {{contact_name}},\n\nIf the quote is not the right fit, I would rather understand why than keep asking for a decision. The issue may be the budget, a term that needs explaining, or a requirement we have not addressed.\n\nWhat is the one thing that would need to change for you to consider it?\n\nI can review what is possible and confirm any revised terms; I cannot promise a lower price or a particular outcome.',
    'Hi {{contact_name}}, what one thing would need to change in the quote for you to consider it? - {{agent_name}}, {{agency_name}}'),
  starter('quote_fourth_followup', 'After quote - follow-up 4: help with the decision', 'Quotes', 'A clear explanation for the decision',
    'Hi {{contact_name}},\n\nIf someone else is helping you review the quote, we can make the discussion more useful by focusing on the questions behind the decision: what is included, what is excluded and what you would pay under the quoted terms.\n\nWould a plain-language summary help you review it together?\n\nReply "summary" and I will focus on the actual quote details, without treating an unverified benefit as a promise.',
    'Hi {{contact_name}}, would a plain-language quote summary help you or another decision-maker review it? Reply "summary". - {{agent_name}}'),
  starter('quote_fifth_followup', 'After quote - follow-up 5: choose a path', 'Quotes', 'Review, revise, or revisit later?',
    'Hi {{contact_name}},\n\nI want to make the next step clear rather than leave you with an open-ended quote review.\n\nWhich path fits best: review the requirements to proceed, explore a specific change, or revisit this later?\n\nReply "requirements", "change" or "later". Before proceeding, we will verify current availability, terms and any binding requirements. This message does not confirm coverage or create a deadline.',
    'Hi {{contact_name}}, for the quote, reply "requirements", "change" or "later". We must verify current terms before proceeding. - {{agent_name}}'),
  starter('quote_sixth_followup', 'After quote - follow-up 6: close the review respectfully', 'Quotes', 'Close the quote review for now?',
    'Hi {{contact_name}},\n\nI have not heard back on the quote, so I do not want to assume you are still considering it or keep repeating the same request.\n\nShould I keep the review open, reconnect at a time you choose, or close the conversation for now?\n\nA short reply is enough. Closing the conversation does not cancel any policy; a later review would require checking current quote terms and availability.',
    'Hi {{contact_name}}, keep the quote review open, reconnect later, or close the conversation for now? - {{agent_name}}, {{agency_name}}'),
  starter('quote_revision', 'Quote revision / recorded concern', 'Quotes', 'Reviewing your requested changes',
    'Hi {{contact_name}},\n\nFor the changes you raised, the next step is:\n\n{{next_step}}\n\nI will confirm what can actually be revised and explain any effect on price or terms before asking you to choose. A requested change is not an approved change.\n\nDoes that address the concern you want us to resolve?\n\nIf not, tell me the specific point that still needs attention.',
    'Hi {{contact_name}}, next for your requested changes: {{next_step}}. Does that address your concern? Revised terms need confirmation. - {{agent_name}}'),
  starter('decision_reminder', 'Decision follow-up', 'Quotes', 'How would you like to proceed?',
    'Hi {{contact_name}},\n\nYou do not need another general reminder to decide. If a question is holding things up, I would like to address that directly; if the timing is wrong, we can acknowledge it instead of forcing a next step.\n\nWhat fits best: discuss one remaining question, review the requirements to proceed, or pause?\n\nReply "question", "requirements" or "pause". We will confirm current terms before any decision to proceed.',
    'Hi {{contact_name}}, for your decision, reply "question", "requirements" or "pause" so I can focus the next step. - {{agent_name}}, {{agency_name}}'),
  starter('binding_next_steps', 'Ready to proceed / binding requirements', 'Closing', 'Requirements for the next step',
    'Hi {{contact_name}},\n\nHere are the confirmed requirements for the next step:\n\n{{binding_requirements}}\n\nWe need to complete the required approvals and binding process before coverage can be confirmed. This email is not a binder or confirmation of an effective date. Do not send payment details by email.\n\nWhich requirement would you like help completing first?\n\nReply with the item and I will explain the appropriate way to handle it.',
    'Hi {{contact_name}}, requirements: {{binding_requirements}}. Which item needs help? No payment details by text. Coverage is not confirmed. - {{agent_name}}'),
  starter('sale_handoff', 'Thank-you / sales handoff', 'Closing', 'Thank you',
    'Hi {{contact_name}},\n\nThank you for working with {{agency_name}}. Here is your next step:\n\n{{next_step}}\n\nPlease use your actual policy documents and binding confirmations to verify coverage terms and effective dates; this thank-you message does not establish them.\n\nIs there anything in the documents or next step you would like me to walk through?\n\nReply with the item so I can help you find a clear answer.',
    'Hi {{contact_name}}, thank you for working with {{agency_name}}. Next: {{next_step}}. Which item would you like help with? - {{agent_name}}'),
  starter('close_loop', 'Final respectful follow-up', 'Reconnect', 'Should I close the loop?',
    'Hi {{contact_name}},\n\nI do not want to keep sending reminders if an insurance review is not useful right now.\n\nWould you prefer to continue, choose a later month, or close the conversation?\n\nReply "continue", a month, or "close". A brief preference is enough; there is no need to justify it. If your needs change later, we can start with current information rather than assume the earlier options still apply.',
    'Hi {{contact_name}}, reply "continue", a better month, or "close" so I know your preference. - {{agent_name}}, {{agency_name}}'),
  starter('reconnect', 'Reconnect with a dormant prospect', 'Reconnect', 'Is a review still useful?',
    'Hi {{contact_name}},\n\nSince we last connected, your requirements or plans may have changed. I do not want to base a new review on old information or assume you still want one.\n\nWould it be useful to revisit your insurance priorities, or would you prefer no further follow-up?\n\nReply "review" or "no follow-up". If you want to reconnect, we can first establish what matters now before discussing options.',
    'Hi {{contact_name}}, would a fresh insurance review be useful? Reply "review" or "no follow-up". - {{agent_name}}, {{agency_name}}'),
];

export function salesFields(template: Pick<SalesTemplate, 'subject' | 'email_body' | 'sms_body'>, channel?: 'email' | 'sms'): SalesField[] {
  const text = channel === 'email' ? `${template.subject}\n${template.email_body}` : channel === 'sms' ? template.sms_body
    : `${template.subject}\n${template.email_body}\n${template.sms_body}`;
  const fields = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]);
  return SALES_FIELDS.filter((field) => fields.includes(field));
}
export function renderSalesTemplate(template: SalesTemplate, channel: 'email' | 'sms', facts: SalesFacts): {
  subject: string; body: string; missing: SalesField[];
} {
  const replace = (text: string): string => text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token, key: string) =>
    SALES_FIELDS.includes(key as SalesField) && facts[key as SalesField]?.trim() ? facts[key as SalesField]!.trim() : token);
  return { subject: channel === 'email' ? replace(template.subject) : '', body: replace(channel === 'email' ? template.email_body : template.sms_body),
    missing: salesFields(template, channel).filter((field) => !facts[field]?.trim()) };
}
export function salesTemplateErrors(template: Pick<SalesTemplate, 'name' | 'category' | 'subject' | 'email_body' | 'sms_body' | 'email_design'>): string[] {
  const errors: string[] = emailDesignErrors(template.email_design);
  if (!template.name.trim() || template.name.length > 150) errors.push('Name must contain 1-150 characters.');
  if (!SALES_CATEGORIES.includes(template.category)) errors.push('Choose a sales category.');
  if (!template.subject.trim() || template.subject.length > 1000 || /[\r\n]/.test(template.subject)) errors.push('Provide a single-line subject of at most 1,000 characters.');
  if (!template.email_body.trim() || template.email_body.length > 10000) errors.push('Email body must contain 1-10,000 characters.');
  if (!template.sms_body.trim() || template.sms_body.length > 1000) errors.push('SMS body must contain 1-1,000 characters.');
  const text = `${template.subject}\n${template.email_body}\n${template.sms_body}`;
  const rest = text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token, field: string) => {
    if (!SALES_FIELDS.includes(field as SalesField)) errors.push(`Unknown field: ${token}`);
    return '';
  });
  if (/[{}]/.test(rest)) errors.push('Use merge fields in the form {{contact_name}}.');
  return errors;
}
export function hasUnresolvedSalesFields(text: string): boolean { return /\{\{|\}\}/.test(text); }

export const SALES_SEQUENCE_PRESETS = {
  initial_contact: { name: 'Initial-contact follow-up', templates: ['introduction', 'close_loop'], requires: null },
  post_appointment: { name: 'Post-appointment follow-up', templates: ['meeting_recap', 'meeting_second_followup', 'close_loop'], requires: 'appointment' },
  quote_followup: { name: 'Quote follow-up', templates: ['quote_first_followup', 'quote_second_followup', 'close_loop'], requires: 'quote' },
} as const;
export interface SalesSequencePlan {
  actor: string;
  preset: keyof typeof SALES_SEQUENCE_PRESETS;
  stage: string;
  assigned_agent: string | null;
  recipient: string;
  sender: OutreachSender & EmailFormatting;
  facts: SalesFacts;
  evidence: { type: 'appointment' | 'quote'; id: string; version: string } | null;
  auto_send: boolean;
  steps: Array<{ template: SalesTemplate; subject: string; body: string; requires_review: boolean }>;
}
