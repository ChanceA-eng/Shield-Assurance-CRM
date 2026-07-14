export type LearningLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export type LessonContentType = 'VIDEO' | 'PDF' | 'TEXT' | 'INTERACTIVE';

export interface LearningQuiz {
  id: string;
  question: string;
  options: string[];
}

export interface LearningLesson {
  id: string;
  title: string;
  order: number;
  contentType: LessonContentType;
  contentUrl: string | null;
  body: string | null;
  quizzes: LearningQuiz[];
}

export interface LearningModule {
  id: string;
  title: string;
  order: number;
  lessons: LearningLesson[];
}

export interface LearningCourse {
  id: string;
  title: string;
  description: string | null;
  level: LearningLevel;
  modules: LearningModule[];
}

export interface LearningProgressSummary {
  lessonId: string;
  completed: boolean;
  percent: number;
  score: number | null;
  lastViewedAt: string;
}

export interface LearningCourseCard {
  id: string;
  title: string;
  description: string | null;
  level: LearningLevel;
  modulesCount: number;
  lessonsCount: number;
  completedLessons: number;
  completionPercent: number;
  resumeLessonId: string | null;
}
