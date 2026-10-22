-- Agrega categoría libre (texto) a consumibles para agrupar en el POS de barra.
-- Idempotente y aditiva (nullable) — segura de aplicar en prod vía `prisma migrate deploy`.
ALTER TABLE "consumibles" ADD COLUMN IF NOT EXISTS "categoria" VARCHAR(100);
