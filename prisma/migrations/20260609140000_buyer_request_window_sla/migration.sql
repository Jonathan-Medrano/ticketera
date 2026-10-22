-- 2026-06-09: 3-field refund model (buyer_request_window_days + manual_review_sla_days)
-- Acompana al campo ya existente buyer_cool_off_window_hours para conformar
-- el modelo de "3 campos de reembolso":
--   1. buyer_request_window_days  -> plazo del comprador para PEDIR reembolso
--   2. buyer_cool_off_window_hours -> si auto-aprobar=ON, ventana para auto-aprobar
--   3. manual_review_sla_days     -> SLA para la empresa; vencido, job auto-aprueba

-- Ventana en dias para que el comprador pueda PEDIR reembolso desde la compra.
-- Fuera de esta ventana, el pedido es rechazado en el endpoint del tenant.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS buyer_request_window_days INTEGER NOT NULL DEFAULT 30;

-- SLA en dias para que la empresa responda al pedido manual.
-- Vencido el SLA sin respuesta, el job auto-aprueba el reembolso.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS manual_review_sla_days INTEGER NOT NULL DEFAULT 7;
