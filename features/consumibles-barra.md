# Features — Consumibles / Barra (POS)
**Rol:** fuente de verdad · **Última actualización:** 2026-06-23

## Qué es esta zona
Catálogo de consumibles por empresa + barras (bares) por evento con stock propio, venta POS interna del personal y venta pública al comprador, canje/entrega por QR o clave corta, promociones y reposición de stock.

## Features
| Feature | Estado | Archivos clave | Notas / deuda |
|---|---|---|---|
| Catálogo de consumibles (CRUD, paginado, búsqueda, sort) | ✅ | `backend/src/routes/consumibles.ts:53` (GET lista), `:198` (POST), `:623` (PUT), `:750` (DELETE) · `platea/components/dashboard/consumibles-content.tsx` | Búsqueda ≥3 chars usa `pg_trgm similarity` + ILIKE; <3 usa ILIKE simple (`:70`, `:153`). Nombre único por empresa case-insensitive (`:233`). DELETE es hard-delete **bloqueado** si hay referencias (stock/ventas/alertas/promos) → pide desactivar (`:709`, `:767`). |
| Validaciones de catálogo (precio/nombre/desc/imagen) | ✅ | `consumibles.ts:18-50,208-229` | Precio >0 máx 1.000.000; nombre ≤100; desc ≤500; `imagen_url` debe ser HTTPS válida. |
| Export catálogo (XLSX/CSV) | ✅ | `consumibles.ts:298` · `backend/src/lib/consumibles-catalogo-workbook.ts` | LIMIT 2000. CSV con BOM. Permiso `ver_consumibles` o `exportar`. |
| Cobertura consumible↔barras + asignación masiva | ✅ | `consumibles.ts:409` (GET `/:id/barras`), `:506` (POST asignaciones, `todas` o `barra_ids`) · `platea/app/api/consumibles/[id]/barras/asignaciones/route.ts` | Upsert por `(barra_id, consumible_id)`; al reasignar recalcula `stock_actual = max(0, nuevo_inicial - vendido)` (`:578-612`). |
| Barras (bares) por evento — CRUD + listado con KPIs | ✅ | `backend/src/routes/barras.ts:81` (GET con agregados sin/low stock), `:133` (POST), `:715` (PUT), `:775` (DELETE) · `platea/components/dashboard/consumibles-barras-content.tsx` | DELETE bloqueado si hay stock/alertas/ventas (`:29`, `:793`). Low-stock = `stock_actual ≤ 20% inicial` (`:104`). |
| Stock por barra (upsert, bulk update con FOR UPDATE, listado) | ✅ | `barras.ts:243` (GET stock), `:484` (POST upsert ON CONFLICT), `:547` (PUT bulk con `prismaDirectUrl` Serializable + FOR UPDATE) | Bulk update loguea en `barra_stock_logs` tipo `ajuste_manual` (`:640`). `stock_actual` no puede superar `stock_inicial` (`:567`). Máx stock 100.000. |
| Stock ilimitado + agotado (flags por asignación) | ✅ | `barras.ts:664` (PATCH `/:barraId/items/:consumibleId` toggle) · schema `barra_stock.stock_ilimitado` / `.agotado` (`schema.prisma:1003-1006`) | `stock_ilimitado`: vende sin contar ni descontar stock. `agotado`: kill-switch manual que bloquea la venta sin importar el número (ver `vender.ts:157-166`). COALESCE: setea solo el flag enviado. |
| Alertas de reposición (restock) | ✅ | `barras.ts:386` (POST crear alerta), `:435` (PATCH resolver) · schema `BarraRestockAlerta` (`schema.prisma:1505`) | Una sola alerta `pendiente` por stock (409 si ya existe). Resolver loguea `restock_resuelto` en `barra_stock_logs`. Permiso `gestionar_consumibles` o `gestionar_stock_barras`. |
| Export barras (resumen por evento + detalle por barra) | ✅ | `barras.ts:184` (Export A resumen), `:314` (Export B detalle stock) · `backend/src/lib/barras-export-workbook.ts` | XLSX/CSV. `/export` declarado antes de `/:id` para no chocar con el param. |
| Venta POS interna (personal de barra) | ✅ | `backend/src/routes/vender.ts:63` (POST `/consumibles/vender`) · `platea/components/dashboard/consumibles-vender-content.tsx` | Transacción `prismaDirectUrl` Serializable + `withSerializableRetry` (P2034) + FOR UPDATE sobre `barra_stock`. Genera `qr_code` (UUID) y `clave_corta` (código corto seguro, retry x10 por unicidad). Estado inicial `pendiente`. Topes anti-abuso: 10.000/ítem, 50.000/venta. **Rate-limited** 300/min (`index.ts:152`). Permiso `vender_consumibles`, userType empresa/empleado. Loguea actividad de empleado. |
| Promociones aplicadas en venta POS | ✅ | `vender.ts:179-260` · `backend/src/routes/promociones.ts` (CRUD) | Tipos: `porcentaje`, `monto_fijo`, `precio_especial`. Valida vigencia (`fecha_inicio/fin`), `cantidad_minima`, `evento_id`. `consumible_ids` (JSON TEXT) define a qué ítems aplica; vacío = todos. Descuento solo sobre ítems elegibles. |
| Canje/entrega por QR o clave corta (preview/confirm/resolve) | ✅ | `backend/src/routes/canjear.ts` · `backend/src/lib/consumibles-redeem.ts` · `platea/components/dashboard/consumibles-canjear-content.tsx` | 3 acciones: preview (escanea código → muestra ítems), `confirmar` (entrega todo) y `resolver` (entrega parcial por línea). Transacción Serializable + FOR UPDATE sobre venta + barra. Auditoría en `consumibles_canje_auditoria`. **Rate-limited** 500/min (`index.ts:160`). Permiso `canjear_consumibles`. |
| Resolución parcial (entrega + refund por faltante de stock) | ✅ | `consumibles-redeem.ts:647` (resolveConsumiblesRedeem), `:364` (refund MP), `:405` (createAutomaticRefundCase) | Por línea: `entregada + reembolsada = cantidad`. Estados resultantes: `canjeado` / `cancelado` / `resuelto_parcial` (`:347`). Refund automático vía Mercado Pago (`PaymentRefund`) con idempotency key; crea `refund_manual_case` flow `consumibles`; revierte profit-sharing post-commit. Requiere `checkout_session_id` (venta de compra confirmada). |
| Venta pública de consumibles al comprador (storefront) | ✅ | `backend/src/routes/tenant.ts:1568` (eventos habilitados), `:1940` (consumibles por evento), `:2494` (checkout) · `platea/app/t/[tenant]/consumibles/*` · `platea/components/tenant/{tenant-consumibles-hub,consumibles-cart-provider,consumibles-checkout-content}.tsx` | Requiere comprador autenticado y evento con `venta_consumibles_habilitada=true` + checkout abierto + `assertCanSell` (Mercado Pago listo). Máx 20 ítems/checkout, mismo evento. Crea `checkout_session`; la venta se confirma vía webhook MP. Carrito client-side (`consumibles-cart-provider`). |
| Mis compras de consumibles (comprador) | ✅ | `tenant.ts:1963` (GET `/mis-consumibles`) · `platea/app/t/[tenant]/consumibles/mis-compras/page.tsx` · `platea/components/tenant/mis-consumibles-content.tsx` | Muestra tickets con QR/clave para canjear en barra. |
| Refunds de consumibles solicitados por el comprador | ✅ | `tenant.ts:2332` (POST `/:slug/consumibles-refund-requests`) · `platea/components/tenant/buyer-consumibles-refund-panel.tsx`, `buyer-consumibles-contract.ts` | Gateado por flag de barra `buyer_consumible_refunds_enabled` (`schema.prisma:966`, default true). El refund ejecutado descuenta cantidad canjeable (`getBuyerExecutedRefundQuantityByVentaItem`, `consumibles-redeem.ts:251`). |
| Reporte de ventas de consumibles (dashboard) | ✅ | `platea/app/api/consumibles/ventas/{route,summary,export,eventos}/route.ts` · `platea/components/dashboard/consumibles-ventas-content.tsx`, `consumibles-ventas-helpers.ts` | Listado + summary + export + filtro por evento. |
| Flag por empresa: módulo consumibles habilitado | ✅ | `schema.prisma:211` (`Empresa.consumibles_habilitado` default true) · `platea/components/super-admin/empresas-section.tsx:947` | Toggle desde super-admin. |
| Logs/auditoría de stock y canje | ✅ | schema `BarraStockLog` (`:1013`), `ConsumiblesCanjeAuditoria` (`:1436`), `ConsumiblesVentaResolucionItem` (`:1084`) | `barra_stock_logs`: `ajuste_manual`, `restock_resuelto`. Auditoría de canje registra preview/resolve ok/rejected con motivo. |
| RBAC de consumibles | ✅ | `backend/src/lib/permisos.ts:33-89` | Permisos: `ver_consumibles`, `gestionar_consumibles`, `gestionar_stock_barras`, `vender_consumibles`, `canjear_consumibles`. Todas las rutas internas exigen `x-internal-secret` (verifyInternal). |

## Lo que NO hay (anti-alucinación)
- **El QR de barra/consumibles NO es el mismo QR que el de la entrada.** Cada venta de consumibles genera su propio `qr_code` (UUID) + `clave_corta` independientes del ticket de entrada (`vender.ts:272-273`, `schema.prisma:1040-1041`).
- **El escáner de canje NO funciona offline** — todo el preview/confirm pasa por transacciones en el backend con FOR UPDATE.
- No hay variantes/modificadores de producto (talles, extras, combos más allá de promociones). El consumible es plano: nombre, descripción, precio, imagen.
- No hay categorías/jerarquía de consumibles (no hay tabla de categorías para el catálogo POS; las "categorías" son de entradas, no de consumibles).
- No hay impresión de tickets de barra ni integración con impresora fiscal.
- `stock_ilimitado` NO descuenta stock; `agotado` es manual y NO se setea solo al llegar a 0 (el stock 0 sin flag simplemente da "stock insuficiente").
- El refund de consumibles requiere una compra confirmada (`checkout_session_id`); ventas POS manuales sin compra asociada no pueden ejecutar refund automático (`consumibles-redeem.ts:740`).

## Ver también
- [../FEATURES.md](../FEATURES.md)
- [checkin-qr.md](./checkin-qr.md)
- [pagos-checkout.md](./pagos-checkout.md)
- [entradas.md](./entradas.md)
- [../playbook-consumibles-canje.md](../playbook-consumibles-canje.md)
- `database.txt` (modelo de stock y queries críticas)
