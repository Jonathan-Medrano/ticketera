-- Add created_at column to compradores
-- Required by dashboard, compradores, marketing, tenant, reconciliacion and refund-manual queries
-- The column was never created during the MySQL→Postgres migration despite the code referencing it.
-- Existing rows get CURRENT_TIMESTAMP as a fallback (not the real registration date, but recoverable).
ALTER TABLE "compradores"
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "compradores_created_at_idx" ON "compradores"("created_at");
