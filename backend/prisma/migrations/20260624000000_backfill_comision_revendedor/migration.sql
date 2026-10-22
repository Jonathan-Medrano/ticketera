-- Backfill defensivo: congela `entradas.comision_revendedor` en filas legacy que
-- tengan revendedor_id pero comision_revendedor = 0 (entradas emitidas antes de que
-- el flujo de confirmar-pago congelara el snapshot por QR).
--
-- El reporting/payouts ahora suma la columna congelada en vez de recalcular con el
-- % ACTUAL del revendedor. Para filas legacy no existe snapshot del % de la época, por
-- lo que se usa el % actual como MEJOR APROXIMACIÓN disponible (mejor que 0).
--
-- Idempotente: solo toca filas con comision_revendedor = 0 y porcentaje_comision > 0.
-- Una segunda corrida no encuentra filas (ya quedaron > 0) → no-op. No escanea ni
-- bloquea filas nuevas; no puede fallar el arranque del contenedor.
UPDATE entradas e
SET comision_revendedor = ROUND(e.precio_pagado * u.porcentaje_comision / 100, 2)
FROM usuarios u
WHERE e.revendedor_id = u.id
  AND e.revendedor_id IS NOT NULL
  AND e.comision_revendedor = 0
  AND u.porcentaje_comision IS NOT NULL
  AND u.porcentaje_comision > 0;
