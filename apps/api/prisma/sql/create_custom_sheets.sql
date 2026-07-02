CREATE TABLE IF NOT EXISTS "custom_sheets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "title" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'General',
  "columns" JSONB NOT NULL,
  "rows" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "custom_sheets_category_idx" ON "custom_sheets" ("category");
CREATE INDEX IF NOT EXISTS "custom_sheets_updatedAt_idx" ON "custom_sheets" ("updatedAt" DESC);

CREATE OR REPLACE FUNCTION update_custom_sheets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_custom_sheets_updated_at ON "custom_sheets";

CREATE TRIGGER set_custom_sheets_updated_at
BEFORE UPDATE ON "custom_sheets"
FOR EACH ROW
EXECUTE FUNCTION update_custom_sheets_updated_at();