-- Add es_prueba flag to empresas.
-- When TRUE, the empresa's data is excluded from super-admin aggregations
-- (client counts, MRR, revenue, fee revenue, etc.). The empresa itself
-- continues to operate normally — the flag only affects platform metrics.
ALTER TABLE "empresas"
  ADD COLUMN "es_prueba" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "empresas_es_prueba_idx" ON "empresas"("es_prueba");
