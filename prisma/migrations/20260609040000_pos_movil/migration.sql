-- POS móvil: venta presencial desde dashboard (boletería en puerta, festivales, kiosko).
-- Feature flag por empresa (OFF por default) + medio de pago + cajero que cobró.

-- AlterTable: empresas
ALTER TABLE "empresas"
  ADD COLUMN "pos_movil_habilitado" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: entradas — campos solo para ventas POS (null en compras online MP)
ALTER TABLE "entradas"
  ADD COLUMN "medio_pago_presencial" VARCHAR(40),
  ADD COLUMN "vendido_by_user_id" VARCHAR(36);

-- Index para reportes POS (qué vendió cada cajero)
CREATE INDEX "entradas_vendido_by_user_id_created_at_idx" ON "entradas"("vendido_by_user_id", "created_at" DESC);
CREATE INDEX "entradas_medio_pago_presencial_idx" ON "entradas"("medio_pago_presencial") WHERE "medio_pago_presencial" IS NOT NULL;
