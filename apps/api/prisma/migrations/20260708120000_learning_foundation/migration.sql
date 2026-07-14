-- Learning foundation schema: courses, modules, lessons, quizzes, blocks, and progress.

CREATE TYPE "LearningLevel" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');
CREATE TYPE "LearningContentType" AS ENUM ('VIDEO', 'PDF', 'TEXT', 'INTERACTIVE');
CREATE TYPE "LearningBlockType" AS ENUM ('VIDEO', 'PDF', 'TEXT', 'CODE', 'QUIZ', 'EXERCISE', 'SIMULATION');

CREATE TABLE "learning_courses" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "level" "LearningLevel" NOT NULL DEFAULT 'BEGINNER',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_courses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_modules" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_modules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_lessons" (
  "id" TEXT NOT NULL,
  "moduleId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "contentType" "LearningContentType" NOT NULL DEFAULT 'TEXT',
  "contentUrl" TEXT,
  "body" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_lessons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_lesson_blocks" (
  "id" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "order" INTEGER NOT NULL DEFAULT 0,
  "type" "LearningBlockType" NOT NULL,
  "title" TEXT,
  "content" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_lesson_blocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_quizzes" (
  "id" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "options" JSONB NOT NULL,
  "answer" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_quizzes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_user_progress" (
  "id" TEXT NOT NULL,
  "learnerKey" TEXT NOT NULL,
  "lessonId" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "score" INTEGER,
  "percent" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "lastViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "learning_user_progress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "learning_modules_courseId_order_key" ON "learning_modules"("courseId", "order");
CREATE INDEX "learning_modules_courseId_idx" ON "learning_modules"("courseId");

CREATE UNIQUE INDEX "learning_lessons_moduleId_order_key" ON "learning_lessons"("moduleId", "order");
CREATE INDEX "learning_lessons_moduleId_idx" ON "learning_lessons"("moduleId");

CREATE UNIQUE INDEX "learning_lesson_blocks_lessonId_order_key" ON "learning_lesson_blocks"("lessonId", "order");
CREATE INDEX "learning_lesson_blocks_lessonId_idx" ON "learning_lesson_blocks"("lessonId");

CREATE INDEX "learning_quizzes_lessonId_idx" ON "learning_quizzes"("lessonId");

CREATE UNIQUE INDEX "learning_user_progress_learnerKey_lessonId_key" ON "learning_user_progress"("learnerKey", "lessonId");
CREATE INDEX "learning_user_progress_learnerKey_idx" ON "learning_user_progress"("learnerKey");
CREATE INDEX "learning_user_progress_lessonId_idx" ON "learning_user_progress"("lessonId");

ALTER TABLE "learning_modules"
ADD CONSTRAINT "learning_modules_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "learning_courses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_lessons"
ADD CONSTRAINT "learning_lessons_moduleId_fkey"
FOREIGN KEY ("moduleId") REFERENCES "learning_modules"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_lesson_blocks"
ADD CONSTRAINT "learning_lesson_blocks_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "learning_lessons"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_quizzes"
ADD CONSTRAINT "learning_quizzes_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "learning_lessons"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "learning_user_progress"
ADD CONSTRAINT "learning_user_progress_lessonId_fkey"
FOREIGN KEY ("lessonId") REFERENCES "learning_lessons"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
