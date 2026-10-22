-- Foto por categoría de entrada (POS más visual, parte 1/2).
-- Nullable, sin backfill, sin constraint → no escanea filas existentes ni bloquea el arranque del backend.
-- Idempotente: IF NOT EXISTS permite re-aplicar sin error.
ALTER TABLE "entrada_categorias" ADD COLUMN IF NOT EXISTS "imagen_url" TEXT;
