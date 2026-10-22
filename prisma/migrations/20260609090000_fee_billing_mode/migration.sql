-- Fee billing mode: quien paga el % de comisión de la plataforma.
-- 'absorbed' (default, comportamiento legacy): organizador absorbe. Comprador paga precio_base,
-- MP descuenta el fee del payout al organizador.
-- 'passed_to_buyer': comprador paga precio_base + fee como "cargo por servicio". Organizador
-- recibe el precio_base completo. El % sigue siendo el mismo, solo cambia quién lo paga.

ALTER TABLE "empresas"
  ADD COLUMN "fee_billing_mode" VARCHAR(30) NOT NULL DEFAULT 'absorbed';
