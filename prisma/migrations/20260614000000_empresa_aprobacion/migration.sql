-- Empresa approval state: companies register freely but stay "pending" until a
-- super-admin approves them. Backfill defaults existing rows to approved (true)
-- so legacy companies keep working; the public registration endpoint sets false.
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "aprobada" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "aprobada_at" TIMESTAMPTZ;
