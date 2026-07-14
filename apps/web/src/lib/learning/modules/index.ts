export interface CreateModuleInput {
  courseId: string;
  title: string;
  order?: number;
}

export interface UpdateModuleInput {
  id: string;
  title?: string;
  order?: number;
}
