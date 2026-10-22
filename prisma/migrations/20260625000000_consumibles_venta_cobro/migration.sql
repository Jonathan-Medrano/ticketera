-- Fase 1 rediseño POS barra: registrar el cobro (medio de pago + efectivo recibido/vuelto)
-- en consumibles_ventas. Columnas NULLABLE nuevas: no rompen filas existentes ni el arranque
-- del backend (no requieren NOT VALID ni backfill). Idempotente con IF NOT EXISTS.
--
-- Naming de medio_pago alineado con el POS de entradas (entradas.medio_pago_presencial):
-- 'efectivo' | 'tarjeta_manual' | 'transferencia'.
-- monto_recibido y vuelto SOLO se setean en efectivo; en tarjeta/transferencia quedan NULL.

ALTER TABLE "consumibles_ventas" ADD COLUMN IF NOT EXISTS "medio_pago" VARCHAR(30);
ALTER TABLE "consumibles_ventas" ADD COLUMN IF NOT EXISTS "monto_recibido" DECIMAL(10,2);
ALTER TABLE "consumibles_ventas" ADD COLUMN IF NOT EXISTS "vuelto" DECIMAL(10,2);
