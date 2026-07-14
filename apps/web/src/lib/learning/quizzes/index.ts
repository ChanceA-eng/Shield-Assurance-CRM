export interface CreateQuizInput {
  lessonId: string;
  question: string;
  options: string[];
  answer: number;
}

export interface SubmitQuizInput {
  quizId: string;
  selected: number;
}
