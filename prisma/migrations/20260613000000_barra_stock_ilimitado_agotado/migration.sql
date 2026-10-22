-- barra_stock: stock ilimitado (no se cuenta/descuenta) + agotado manual (kill-switch).
-- Idempotente y seguro sobre tabla con datos: ADD COLUMN con DEFAULT es instantáneo en PG11+.
ALTER TABLE "barra_stock" ADD COLUMN IF NOT EXISTS "stock_ilimitado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "barra_stock" ADD COLUMN IF NOT EXISTS "agotado" BOOLEAN NOT NULL DEFAULT false;
