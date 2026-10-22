-- Modo de comisión 'split': la empresa elige qué % de la comisión paga el comprador
-- (fee_split_buyer_pct, 0..100) y absorbe el resto. Null en los modos 'absorbed'/'passed_to_buyer'.
-- Columna nullable sobre tabla con datos = seguro, no escanea filas. Idempotente para re-deploy.
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "fee_split_buyer_pct" DECIMAL(5,2);
