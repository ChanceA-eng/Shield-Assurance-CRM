CREATE TABLE IF NOT EXISTS "commercial_quotes" (
  "id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_quotes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "commercial_quotes_account_id_idx" ON "commercial_quotes"("account_id");
CREATE INDEX IF NOT EXISTS "commercial_quotes_created_at_idx" ON "commercial_quotes"("created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'commercial_quotes_account_id_fkey'
      AND table_name = 'commercial_quotes'
  ) THEN
    ALTER TABLE "commercial_quotes"
      ADD CONSTRAINT "commercial_quotes_account_id_fkey"
      FOREIGN KEY ("account_id") REFERENCES "commercial_accounts"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
