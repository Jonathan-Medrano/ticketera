-- Add created_at and updated_at columns to eventos.
-- Required by eventos list, dashboard resumen, revendedores list and several JOINs.
-- The columns were never created during the MySQL→Postgres migration despite the code referencing them.
ALTER TABLE "eventos"
  ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Best-effort backfill: use published_live_at where available (closer to real event creation).
UPDATE "eventos"
  SET "created_at" = "published_live_at"
  WHERE "published_live_at" IS NOT NULL;

CREATE INDEX "eventos_created_at_idx" ON "eventos"("created_at");
