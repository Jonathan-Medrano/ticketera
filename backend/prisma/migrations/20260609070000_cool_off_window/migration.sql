-- Cool-off window: ventana de horas desde confirmed_at en la que el comprador puede
-- pedir refund con auto-aprobación. 0 = sin cool-off (comportamiento previo, auto solo
-- si buyer_auto_refunds_enabled es true sin importar tiempo).
-- Requiere también buyer_event_refunds_enabled + buyer_auto_refunds_enabled para tener efecto.
-- Si > 0: refund se auto-aprueba SOLO si (NOW - confirmed_at) <= window_hours AND evento_fecha > NOW.

ALTER TABLE "empresas"
  ADD COLUMN "buyer_cool_off_window_hours" INTEGER NOT NULL DEFAULT 0;
