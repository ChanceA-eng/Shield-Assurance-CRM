export interface CreateLessonInput {
  moduleId: string;
  title: string;
  order?: number;
  contentType: 'VIDEO' | 'PDF' | 'TEXT' | 'INTERACTIVE';
  contentUrl?: string | null;
  body?: string | null;
}

export interface UpdateLessonInput {
  id: string;
  title?: string;
  order?: number;
  contentType?: 'VIDEO' | 'PDF' | 'TEXT' | 'INTERACTIVE';
  contentUrl?: string | null;
  body?: string | null;
}
