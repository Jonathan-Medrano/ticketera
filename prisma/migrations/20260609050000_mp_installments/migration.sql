-- Configuración de cuotas máximas para checkout MP por empresa.
-- Default 1 = pago en 1 cuota (comportamiento actual).
-- Si > 1, se pasa al SDK de MP como payment_methods.installments y el comprador puede elegir.
-- Cuotas SIN INTERÉS se configuran en el panel de MP del vendedor (NO acá).

ALTER TABLE "empresas"
  ADD COLUMN "mp_max_installments" INTEGER NOT NULL DEFAULT 1;
