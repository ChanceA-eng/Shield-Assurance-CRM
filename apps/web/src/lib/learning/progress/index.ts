export interface UpdateProgressInput {
  learnerKey: string;
  lessonId: string;
  completed?: boolean;
  percent?: number;
  score?: number | null;
}

export interface ProgressResponseItem {
  lessonId: string;
  completed: boolean;
  percent: number;
  score: number | null;
  lastViewedAt: string;
}
