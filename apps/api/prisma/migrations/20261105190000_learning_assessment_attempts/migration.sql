CREATE TABLE "learning_assessment_attempts" (
  "id" TEXT NOT NULL,
  "learnerKey" TEXT NOT NULL,
  "moduleNumber" INTEGER NOT NULL,
  "score" INTEGER NOT NULL,
  "questionCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "learning_assessment_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_assessment_attempts_module_number_check" CHECK ("moduleNumber" BETWEEN 1 AND 11),
  CONSTRAINT "learning_assessment_attempts_score_check" CHECK ("score" >= 0 AND "score" <= 100),
  CONSTRAINT "learning_assessment_attempts_question_count_check" CHECK ("questionCount" > 0)
);

CREATE INDEX "learning_assessment_attempts_learnerKey_moduleNumber_createdAt_idx"
  ON "learning_assessment_attempts"("learnerKey", "moduleNumber", "createdAt");
