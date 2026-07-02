CREATE TABLE IF NOT EXISTS "commercial_accounts" (
  "id" TEXT NOT NULL,
  "legal_name" VARCHAR(255) NOT NULL,
  "dba_name" VARCHAR(255),
  "entity_type" VARCHAR(50) NOT NULL,
  "fein" VARCHAR(9) NOT NULL,
  "physical_address" TEXT NOT NULL,
  "gross_revenue" DECIMAL(15, 2) NOT NULL,
  "years_experience" INTEGER NOT NULL,
  "has_employees" BOOLEAN NOT NULL DEFAULT false,
  "has_subcontractors" BOOLEAN NOT NULL DEFAULT false,
  "has_property" BOOLEAN NOT NULL DEFAULT false,
  "has_autos" BOOLEAN NOT NULL DEFAULT false,
  "industry_group" VARCHAR(100) NOT NULL,
  "naics_code" VARCHAR(6) NOT NULL,
  "risk_profile_metadata" JSONB,
  "risk_snapshot" JSONB,
  "risk_completeness_score" INTEGER,
  "carrier_matrix" JSONB,
  "consent_ip" VARCHAR(45) NOT NULL,
  "consent_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "commercial_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_accounts_fein_key" ON "commercial_accounts"("fein");
CREATE INDEX IF NOT EXISTS "commercial_accounts_industry_group_idx" ON "commercial_accounts"("industry_group");
CREATE INDEX IF NOT EXISTS "commercial_accounts_created_at_idx" ON "commercial_accounts"("created_at");
