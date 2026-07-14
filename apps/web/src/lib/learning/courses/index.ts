import type { LearningCourse } from '../types';

export interface CreateCourseInput {
  title: string;
  description?: string;
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}

export interface UpdateCourseInput {
  id: string;
  title?: string;
  description?: string | null;
  level?: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
}

export interface CoursesListResponse {
  courses: LearningCourse[];
}
