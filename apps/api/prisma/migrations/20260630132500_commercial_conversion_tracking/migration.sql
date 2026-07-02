ALTER TABLE "commercial_accounts"
  ADD COLUMN IF NOT EXISTS "converted_client_id" TEXT,
  ADD COLUMN IF NOT EXISTS "converted_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "commercial_accounts_converted_client_id_idx" ON "commercial_accounts"("converted_client_id");
