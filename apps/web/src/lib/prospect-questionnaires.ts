import { isRecord, isUuid } from './workspace-validation';
import { WorkspaceError } from './record-scope';

export const QUESTION_TYPES = ['text', 'long_text', 'number', 'date', 'choice', 'multiple', 'yes_no', 'file'] as const;
export type QuestionType = typeof QUESTION_TYPES[number];
export const QUESTION_FIELDS = ['full_name', 'phone', 'address', 'line_of_business'] as const;
export type QuestionField = typeof QUESTION_FIELDS[number];
export interface ProspectQuestion {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options: string[];
  field: QuestionField | '';
}
export interface QuestionnaireDesign { name: string; questions: ProspectQuestion[] }
export interface QuestionnaireTemplate extends QuestionnaireDesign {
  id: string; owner_id: string | null; revision: number; source_id: string | null;
}
export type ProspectAnswers = Record<string, string | string[]>;
export interface ProspectContact { first_name: string; last_name: string }
export const MAX_PROSPECT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PROSPECT_TOTAL_BYTES = 50 * 1024 * 1024;
export const MAX_PROSPECT_FILES = 10;

export function parseProspectContact(value: unknown): ProspectContact {
  if (!isRecord(value) || typeof value.first_name !== 'string' || typeof value.last_name !== 'string'
    || !value.first_name.trim() || !value.last_name.trim() || value.first_name.length > 80 || value.last_name.length > 80
    || /[\u0000-\u001f]/.test(value.first_name + value.last_name)) {
    throw new WorkspaceError('Enter your first and last name before requesting a verification code.', 400);
  }
  return { first_name: value.first_name.trim(), last_name: value.last_name.trim() };
}

export function parseQuestionnaire(value: unknown): QuestionnaireDesign {
  if (!isRecord(value) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120
    || !Array.isArray(value.questions) || !value.questions.length || value.questions.length > 50) {
    throw new WorkspaceError('Provide a template name and between 1 and 50 questions.', 400);
  }
  const ids = new Set<string>(), fields = new Set<string>();
  const questions = value.questions.map((question: unknown): ProspectQuestion => {
    if (!isRecord(question) || !isUuid(question.id) || ids.has(question.id)
      || typeof question.label !== 'string' || !question.label.trim() || question.label.length > 300
      || !QUESTION_TYPES.some((type) => type === question.type) || typeof question.required !== 'boolean'
      || !Array.isArray(question.options) || question.options.length > 40
      || !question.options.every((option: unknown) => typeof option === 'string' && option.trim() && option.length <= 120)
      || (question.field !== '' && !QUESTION_FIELDS.some((field) => field === question.field))) {
      throw new WorkspaceError('Check question labels, types, choices and field mappings.', 400);
    }
    const type = QUESTION_TYPES.find((entry) => entry === question.type)!;
    const field = QUESTION_FIELDS.find((entry) => entry === question.field) ?? '';
    const options = question.options.map((option: string) => option.trim());
    if ((['choice', 'multiple'].includes(type) && (!options.length || new Set(options).size !== options.length))
      || (!['choice', 'multiple'].includes(type) && options.length)
      || (field && (fields.has(field) || type !== 'text'))) {
      throw new WorkspaceError('Use unique choices and map each text field only once.', 400);
    }
    ids.add(question.id);
    if (field) fields.add(field);
    return { id: question.id, label: question.label.trim(), type, required: question.required, options, field };
  });
  return { name: value.name.trim(), questions };
}

export function parseProspectAnswers(design: QuestionnaireDesign, input: unknown): ProspectAnswers {
  if (!isRecord(input) || Object.keys(input).some((key) => !design.questions.some((question) => question.id === key && question.type !== 'file'))) {
    throw new WorkspaceError('Submit answers only for this questionnaire.', 400);
  }
  const answers: ProspectAnswers = {};
  for (const question of design.questions) {
    if (question.type === 'file') continue;
    const value = input[question.id] ?? (question.type === 'multiple' ? [] : '');
    if (question.type === 'multiple') {
      if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === 'string' && question.options.includes(item))
        || new Set(value).size !== value.length || (question.required && !value.length)) {
        throw new WorkspaceError(`Choose valid answers for ${question.label}.`, 400);
      }
      answers[question.id] = value;
      continue;
    }
    if (typeof value !== 'string' || value.length > (question.type === 'long_text' ? 4000 : 500)) {
      throw new WorkspaceError(`Check ${question.label}.`, 400);
    }
    const text = value.trim();
    if (question.required && !text) throw new WorkspaceError(`Complete ${question.label}.`, 400);
    if (text && ((question.type === 'choice' && !question.options.includes(text))
      || (question.type === 'yes_no' && !['Yes', 'No'].includes(text))
      || (question.type === 'number' && (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))))
      || (question.type === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(Date.parse(text))
        || new Date(text).toISOString().slice(0, 10) !== text)))) {
      throw new WorkspaceError(`Check ${question.label}.`, 400);
    }
    answers[question.id] = text;
  }
  return answers;
}

export function prospectUpload(input: Record<string, unknown>): { name: string; size: number; type: string } {
  const allowed: Record<string, string> = {
    pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  };
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const type = allowed[name.split('.').at(-1)?.toLowerCase() ?? ''];
  if (!name || name.length > 200 || /[\\/\u0000-\u001f]/.test(name) || !type
    || !Number.isSafeInteger(input.size) || Number(input.size) < 1 || Number(input.size) > MAX_PROSPECT_FILE_BYTES) {
    throw new WorkspaceError('Choose a PDF or supported phone image, no larger than 10 MB.', 400);
  }
  return { name, size: Number(input.size), type };
}
