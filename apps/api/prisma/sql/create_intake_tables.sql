-- Additive-only creation of Prisma-managed intake tables.
-- Safe to re-run: uses IF NOT EXISTS and does not touch existing supabase-managed tables.

CREATE TABLE IF NOT EXISTS "commercial_accounts" (
    "id" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "dba_name" TEXT,
    "entity_type" TEXT NOT NULL,
    "fein" TEXT NOT NULL,
    "physical_address" TEXT NOT NULL,
    "gross_revenue" DECIMAL(15,2) NOT NULL,
    "years_experience" INTEGER NOT NULL,
    "has_employees" BOOLEAN NOT NULL DEFAULT false,
    "has_subcontractors" BOOLEAN NOT NULL DEFAULT false,
    "has_property" BOOLEAN NOT NULL DEFAULT false,
    "has_autos" BOOLEAN NOT NULL DEFAULT false,
    "industry_group" TEXT NOT NULL,
    "naics_code" TEXT NOT NULL,
    "risk_profile_metadata" JSONB,
    "risk_snapshot" JSONB,
    "risk_completeness_score" INTEGER,
    "carrier_matrix" JSONB,
    "consent_ip" TEXT NOT NULL,
    "consent_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted_client_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "personal_accounts" (
    "id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "dob" DATE NOT NULL,
    "primary_phone" TEXT NOT NULL,
    "primary_email" TEXT NOT NULL,
    "street_address" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'AZ',
    "zip_code" TEXT NOT NULL,
    "current_carrier" TEXT,
    "current_policy_expiration" DATE,
    "credit_score_tier" TEXT,
    "raw_carrier_data" JSONB,
    "auto_snapshot" JSONB,
    "property_snapshot" JSONB,
    "quote_modules" JSONB,
    "consent_ip" TEXT NOT NULL,
    "consent_timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted_client_id" TEXT,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "commercial_quotes" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commercial_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "commercial_quotes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "commercial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "commercial_accounts_fein_key" ON "commercial_accounts"("fein");
CREATE INDEX IF NOT EXISTS "commercial_accounts_industry_group_idx" ON "commercial_accounts"("industry_group");
CREATE INDEX IF NOT EXISTS "commercial_accounts_converted_client_id_idx" ON "commercial_accounts"("converted_client_id");
CREATE INDEX IF NOT EXISTS "commercial_accounts_created_at_idx" ON "commercial_accounts"("created_at");

CREATE INDEX IF NOT EXISTS "commercial_quotes_account_id_idx" ON "commercial_quotes"("account_id");
CREATE INDEX IF NOT EXISTS "commercial_quotes_created_at_idx" ON "commercial_quotes"("created_at");

CREATE INDEX IF NOT EXISTS "personal_accounts_last_name_first_name_idx" ON "personal_accounts"("last_name", "first_name");
CREATE INDEX IF NOT EXISTS "personal_accounts_converted_client_id_idx" ON "personal_accounts"("converted_client_id");
CREATE INDEX IF NOT EXISTS "personal_accounts_current_policy_expiration_idx" ON "personal_accounts"("current_policy_expiration");
CREATE INDEX IF NOT EXISTS "personal_accounts_created_at_idx" ON "personal_accounts"("created_at");
