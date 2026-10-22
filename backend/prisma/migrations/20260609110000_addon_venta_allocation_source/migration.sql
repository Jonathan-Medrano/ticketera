-- Add 'addon_venta' como source_type válido para platform_sale_allocations.
-- Esto permite trackear el profit-sharing de los addon_ventas (parking/meet&greet/merch)
-- igual que se hace con entradas. Comparten flow='entradas' porque son revenue del evento.
--
-- ALTER TYPE ... ADD VALUE no se puede correr dentro de una transacción en Postgres,
-- así que se ejecuta como statement aislado. ADD VALUE IF NOT EXISTS es idempotente.

ALTER TYPE "PlatformSaleAllocSourceTypeEnum" ADD VALUE IF NOT EXISTS 'addon_venta';
