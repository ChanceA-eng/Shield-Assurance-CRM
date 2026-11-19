import { WorkspaceError } from './record-scope';
import { isRecord } from './workspace-validation';

export const CAPTION_STARTERS = [
  { id: 'review', label: 'Coverage review', text: 'Life changes. Your coverage may need a second look.\n\nIf you have moved, bought a vehicle, or started a business, ask our team about reviewing your insurance options.' },
  { id: 'tip', label: 'Practical tip', text: 'A simple insurance habit: keep your policy documents somewhere you can find them.\n\nKnow where to check your limits, deductibles, and renewal date. Have a question? Our team can help you review the details.' },
  { id: 'question', label: 'Start a conversation', text: 'What is one insurance question you have been meaning to ask?\n\nUnderstanding your options starts with a conversation. Reach out to our team.' },
  { id: 'business', label: 'Business check-in', text: 'Has your business changed since your last insurance review?\n\nNew equipment, vehicles, or services are worth discussing with your agent. Ask our team about your options.' },
] as const;

export interface CaptionSuggestionInput { topic: string; caption: string }
export function captionSuggestionInput(value: unknown): CaptionSuggestionInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !['topic', 'caption'].includes(key))
    || typeof value.topic !== 'string' || !value.topic.trim() || value.topic.length > 500 || value.topic.includes('\0')
    || typeof value.caption !== 'string' || value.caption.length > 2000 || value.caption.includes('\0')) {
    throw new WorkspaceError('Enter a topic of 1-500 characters and a starting caption of up to 2,000 characters.', 400);
  }
  return { topic: value.topic.trim(), caption: value.caption.trim() };
}

export function parseCaptionSuggestions(raw: string): string[] {
  let value: unknown;
  try { value = JSON.parse(raw); }
  catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new WorkspaceError('AI returned an unreadable suggestion. Your caption was not changed. Use a starter or try again.', 502);
  }
  if (!isRecord(value) || !Array.isArray(value.captions) || value.captions.length !== 3
    || !value.captions.every((caption): caption is string => typeof caption === 'string' && Boolean(caption.trim())
      && caption.length <= 1000 && !caption.includes('\0'))
    || new Set(value.captions.map((caption: string) => caption.trim())).size !== 3) {
    throw new WorkspaceError('AI did not return three usable captions. Your caption was not changed. Use a starter or try again.', 502);
  }
  return value.captions.map((caption: string) => caption.trim());
}
