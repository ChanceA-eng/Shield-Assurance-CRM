CREATE TABLE IF NOT EXISTS "personal_accounts" (
  "id" TEXT NOT NULL,
  "first_name" VARCHAR(100) NOT NULL,
  "last_name" VARCHAR(100) NOT NULL,
  "dob" DATE NOT NULL,
  "primary_phone" VARCHAR(15) NOT NULL,
  "primary_email" VARCHAR(255) NOT NULL,
  "street_address" TEXT NOT NULL,
  "city" VARCHAR(100) NOT NULL,
  "state" VARCHAR(2) NOT NULL DEFAULT 'AZ',
  "zip_code" VARCHAR(5) NOT NULL,
  "current_carrier" VARCHAR(100),
  "current_policy_expiration" DATE,
  "credit_score_tier" VARCHAR(50),
  "raw_carrier_data" JSONB,
  "auto_snapshot" JSONB,
  "property_snapshot" JSONB,
  "quote_modules" JSONB,
  "consent_ip" VARCHAR(45) NOT NULL,
  "consent_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personal_accounts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "personal_accounts_last_name_first_name_idx" ON "personal_accounts"("last_name", "first_name");
CREATE INDEX IF NOT EXISTS "personal_accounts_current_policy_expiration_idx" ON "personal_accounts"("current_policy_expiration");
CREATE INDEX IF NOT EXISTS "personal_accounts_created_at_idx" ON "personal_accounts"("created_at");
