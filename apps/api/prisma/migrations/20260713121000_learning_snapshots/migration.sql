CREATE TABLE "learning_course_snapshots" (
  "id" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_course_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_course_snapshots_courseId_createdAt_idx" ON "learning_course_snapshots"("courseId", "createdAt");

ALTER TABLE "learning_course_snapshots"
ADD CONSTRAINT "learning_course_snapshots_courseId_fkey"
FOREIGN KEY ("courseId") REFERENCES "learning_courses"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
