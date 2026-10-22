-- Fase 3 — Red de seguridad a nivel DB para consumibles/barras.
--
-- Se agregan como NOT VALID a propósito: el constraint aplica a TODA escritura
-- nueva (INSERT/UPDATE) pero NO escanea las filas existentes. Así la migración
-- NO puede fallar por datos viejos sucios y no bloquea el arranque del backend
-- en Fly (`prisma migrate deploy` corre en el CMD del contenedor).
--
-- El código de la app ya previene estas violaciones (stock con FOR UPDATE +
-- Serializable, validaciones de monto). Esto es solo la red de seguridad de la DB.
--
-- Solo invariantes de NO-NEGATIVIDAD (inequívocos). NO se incluye `descuento <= total`
-- porque es FALSO en el modelo: total = subtotal - descuento, así que un descuento
-- grande (ej. 60%) supera legítimamente al total final.
--
-- Idempotente: cada constraint se agrega solo si no existe (safe para re-run).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_barra_stock_no_negativo') THEN
    ALTER TABLE barra_stock
      ADD CONSTRAINT chk_barra_stock_no_negativo
      CHECK (stock_actual >= 0 AND stock_inicial >= 0) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_consumibles_ventas_montos') THEN
    ALTER TABLE consumibles_ventas
      ADD CONSTRAINT chk_consumibles_ventas_montos
      CHECK (
        total >= 0
        AND descuento >= 0
        AND (delivered_amount IS NULL OR delivered_amount >= 0)
        AND (refunded_amount IS NULL OR refunded_amount >= 0)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_consumibles_venta_items_montos') THEN
    ALTER TABLE consumibles_venta_items
      ADD CONSTRAINT chk_consumibles_venta_items_montos
      CHECK (cantidad > 0 AND precio_unitario >= 0 AND subtotal >= 0) NOT VALID;
  END IF;
END $$;
