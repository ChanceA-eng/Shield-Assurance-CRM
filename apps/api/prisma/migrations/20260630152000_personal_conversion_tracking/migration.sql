ALTER TABLE "personal_accounts"
  ADD COLUMN IF NOT EXISTS "converted_client_id" TEXT,
  ADD COLUMN IF NOT EXISTS "converted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "personal_accounts_converted_client_id_idx" ON "personal_accounts"("converted_client_id");
