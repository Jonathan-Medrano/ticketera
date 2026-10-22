# Features — Entradas (eventos, categorías, stock, emisión)
**Rol:** fuente de verdad · **Última actualización:** 2026-06-23

## Qué es esta zona
El núcleo del producto: alta/edición de eventos con sus categorías de entrada, tandas y fechas, el modelo de stock por categoría (`stock`/`stock_disponible`), y la emisión de tickets (`entradas`) con QR + clave corta al confirmarse el pago.

## Features
| Feature | Estado | Archivos clave | Notas / deuda |
|---|---|---|---|
| Crear evento | ✅ | `backend/src/routes/eventos.ts:1018` (POST `/`); `platea/components/dashboard/evento-form-content.tsx` | Inserta en `eventos` + sync de fechas/tandas/categorías en una sola tx `Serializable` sobre `prismaDirectUrl`. Requiere nombre, `modo_fecha`, ≥1 categoría, ≥1 fecha. Permiso empleado: `crear_eventos`. Valida `imagen_url` HTTPS. |
| Editar evento | ✅ | `eventos.ts:1725` (PATCH `/:id`) | Misma tx serializable; re-sincroniza fechas/tandas/categorías y poda las eliminadas (`pruneRemovedTandas`). Permiso: `editar_eventos`. |
| Activar/desactivar evento | ✅ | `eventos.ts:1741` (PATCH `accion=toggle_activo`) | `UPDATE ... SET activo = NOT activo`. Permiso: `activar_eventos`. `activo=false` ⇒ status `manual_inactive`. |
| `modo_fecha` (única/múltiple/pase) | 🚧 | enum `ModofechaEnum` `schema.prisma:40`; `eventos.ts:102` `isModoFechaValido` | El enum DB tiene `unica\|multiple\|pase`, pero la validación de create/edit **solo acepta `unica` o `multiple`** (`isModoFechaValido`). `pase` existe en DB y en velocity (`eventos.ts:1503` lo rechaza), pero no se puede setear vía API normal. ⚠️ inconsistencia enum vs validación. |
| Fechas del evento (`evento_fechas`) | ✅ | `eventos.ts:379` `syncFechas`; modelo `EventoFecha` `schema.prisma:623` | `timestamptz`. No se puede borrar una fecha que ya tiene `entradas` emitidas (`eventos.ts:414`). |
| Categorías de entrada (`entrada_categorias`) | ✅ | `eventos.ts:422` `syncCategorias`; modelo `EntradaCategoria` `schema.prisma:633` | Campos: `nombre`, `descripcion`, `precio` (Decimal 10,2), `stock`, `stock_disponible`, `activa`, `tanda_id`, `entradas_por_unidad`. Precio 0–10M (`MAX_CATEGORY_PRICE`), stock entero 0–100000. |
| Tandas (`evento_tandas`) | ✅ | `eventos.ts:316` `syncTandas`, `:510` `normalizeEstadosTandas`; modelo `EventoTanda` `schema.prisma:606` | Estados: `activa\|proxima\|inactiva\|agotada`. **Solo 1 tanda `activa` por evento (MVP)** — `validateTandas` `eventos.ts:268`. Una tanda activa requiere ≥1 categoría asociada. |
| Acciones de tanda (activar/inactivar/agotar/actualizar) | ✅ | `eventos.ts:1839` (PATCH `/:id/tandas/:tandaId`) | `activar` exige categoría activa en la tanda; pone las demás en `proxima` (salvo `agotada`). Permiso estado: `activar_eventos`; edición: `editar_eventos`. |
| Agregar stock a categoría | ✅ | `eventos.ts:2018` (PATCH `accion=agregar_stock`) | `FOR UPDATE` en `prismaDirectUrl`; suma a `stock` Y `stock_disponible`. Tope `MAX_STOCK_INCREMENT=10000`. Permiso: `editar_eventos`. |
| Cambiar precio de categoría | ✅ | `eventos.ts:2044` (PATCH `accion=cambiar_precio`) | UPDATE directo de `precio`. No hay historial de precios por tanda más allá de las tandas mismas. |
| Activar/desactivar categoría | ✅ | `eventos.ts:2038` (PATCH `accion=toggle_activa`) | `SET activa = NOT activa`. |
| Modelo de stock (reserva soft) | ✅ | `tenant.ts:2987` (reserva con `FOR UPDATE OF ec`), `:3199` (decremento) | Al reservar checkout: `UPDATE entrada_categorias SET stock_disponible = stock_disponible - cantidad`. `stock` = capacidad total; `stock_disponible` = lo libre. Vendidas = `GREATEST(stock - stock_disponible, 0)`. **Nunca** se usa el pooler para el lock. |
| Guard al bajar/eliminar stock | ✅ | `eventos.ts:450`, `:500` | No se puede bajar `stock` por debajo del comprometido (`stock - stock_disponible`), ni borrar categoría con stock comprometido/vendido. |
| Emisión de entradas al confirmar pago | ✅ | `tenant.ts:1120`–`1235` (`tx.entrada.create`) | Por cada unidad comprada genera `entrada` con `qr_code` (uuid) + `clave_corta` (`generateSecureShortCode`, reintenta hasta 10x ante colisión P2002). Estado inicial `valida`. Tx serializable. |
| Pack model (`entradas_por_unidad`) | ✅ | `schema.prisma:645`; `tenant.ts:1121`–`1170`; form `evento-form-content.tsx:890` | 1 = entrada normal; >1 = pack 2x1/3x2 → 1 unidad de stock genera N QRs. Precio/comisión/mp_fee/neto se splittean entre los N QRs. Rango 1–10. El stock se cuenta en UNIDADES del pack, no en QRs. |
| Estados de `entrada` | ✅ | modelo `Entrada` `schema.prisma:758` | `valida` (emitida) → `usada` (check-in) → `cancelada` (reembolso). KPIs cuentan `IN ('valida','usada')` como vendidas. |
| Estados de publicación del evento | ✅ | `eventos.ts:884`, `:1158`; `backend/src/lib/event-publication.ts` | `publication_mode` (`immediate\|scheduled`), `pre_publish_visibility` (`hidden\|listado_solo\|detail_visible`), `publish_at_utc`/`publish_timezone`/`published_live_at`. Status derivado: `live\|listed\|hidden\|manual_inactive`. |
| Storefront tenant: selección de entradas | ✅ | `tenant.ts:1927`, `:2416` (categorías visibles); `platea/app/t/[tenant]/evento/` | Solo muestra categorías `activa=true AND stock_disponible > 0`. Stock de tanda agregada en `tenant.ts:1537`. |
| Listado de eventos dashboard + KPIs | ✅ | `eventos.ts:809` (GET `/`); `platea/components/dashboard/eventos-content.tsx` | Paginado, búsqueda (nombre evento O nombre categoría), sort por nombre/estado/fechas/categorías/vendidas/capacidad/alta + KPIs financieros gated por `ver_kpis_eventos`. |
| Detalle de evento + métricas | ✅ | `eventos.ts:1616` (GET `/:id`); `evento-detalle-content.tsx` | Trae tandas, categorías, fechas, últimas 20 ventas y métricas (vendidas/usadas/canceladas/bruto/neto). Precios gated por `ver_precios_entradas`/`ver_recaudacion`. |
| Summary de eventos (totales + performers) | ✅ | `eventos.ts:1112` (GET `/summary`) | Agregados + top/bottom por ingresos y ocupación. Permiso: `ver_recaudacion`. |
| Comparar eventos (hasta 4) | ✅ | `eventos.ts:1318` (GET `/comparar`); `eventos-compare-content.tsx` | Side-by-side + category_mix. Tenant-scoped (drop de UUIDs ajenos/malformados). |
| Velocity de ventas (hasta 8) | ✅ | `eventos.ts:1456` (GET `/velocity`); `eventos-velocity-content.tsx`; tabla `evento_ventas_snapshot` `schema.prisma:653` | Serie normalizada a `days_before_event`. Requiere `ver_kpis_eventos`. Rechaza eventos `pase`. |
| Listado/export de entradas emitidas | ✅ | `backend/src/routes/entradas.ts:294` (GET `/`), `:554` (`/export`); `entradas-content.tsx` | CSV/XLSX. Permiso `ver_entradas`; export `exportar` (límite `ENTRADAS_EXPORT_MAX_ROWS`, default 2000). Campos sensibles (precio/email/dni) gated por permisos. |
| Summary de entradas (serie diaria 30d) | ✅ | `entradas.ts:408` (GET `/summary`) | Periodos hoy/7d/30d + ticket promedio neto + tasa de cancelación. Permiso: `ver_recaudacion`. |
| Liquidación financiera por evento (export) | ✅ | `eventos.ts:554` (GET `/liquidacion/export`) | CSV/XLSX: bruto, comisión plataforma, neto empresa de entradas + consumibles. Permiso: `exportar` + `ver_recaudacion`. |
| Add-ons de evento (`evento_addons`) | ✅ | modelo `EventoAddon` `schema.prisma:804`; `evento-addons-section.tsx`; `tenant.ts:3074` | Ítems opcionales al checkout (parking, merch, meet&greet). Cada unidad genera QR canjeable. Stock propio (`stock`/`stock_disponible`/`max_por_compra`). |
| Toggle venta de consumibles por evento | ✅ | `eventos.ts:1750` (PATCH `accion=toggle_venta_consumibles_habilitada`); flag `venta_consumibles_habilitada` `schema.prisma:596` | Habilita el módulo barra/consumibles para ese evento. |
| Refunds de evento por comprador (flag) | ✅ | flag `buyer_event_refunds_enabled` `schema.prisma:597`; set en POST/PATCH | Permite que el comprador inicie reembolso desde el storefront para ese evento. |

## Lo que NO hay (anti-alucinación)
- **NO hay flag de "stock ilimitado" ni "agotado" para categorías de entrada.** Esos flags (`stock_ilimitado`, `agotado`) existen SOLO para consumibles/barra (`barra_stock`, ver `tenant.ts:2620`, `consumibles-barra.md`). Una categoría de entrada siempre tiene `stock` finito; "agotada" se modela vía estado de **tanda** (`evento_tandas.estado='agotada'`), no por categoría.
- **NO se puede crear/editar un evento con `modo_fecha = 'pase'` por la API.** El enum lo tiene, pero `isModoFechaValido` solo deja pasar `unica`/`multiple`. ⚠️ deuda.
- **NO hay historial de cambios de precio** más allá del mecanismo de tandas. `cambiar_precio` pisa el `precio` actual sin versionado.
- **NO hay límite real de tandas activas múltiples** — está cazado a "1 activa por evento (MVP)" deliberadamente (`validateTandas`).
- **NO hay generación de entradas vía `INSERT INTO entradas` crudo en producción** — la emisión online usa `tx.entrada.create` (Prisma ORM, `tenant.ts:1150`); el `INSERT INTO entradas` raw solo aparece en tests y en `reconciliacion.ts:788` (re-emisión manual de reconciliación).
- **NO hay reembolso parcial de una entrada individual del pack** documentado acá: el pack splittea montos pero la cancelación es por entrada.

## Deuda / ⚠️ detectada
- ⚠️ **`modo_fecha='pase'`**: enum vs validación inconsistentes (ver arriba).
- ⚠️ **Timezone en queries de eventos/KPIs**: varias agregaciones usan `created_at` directo o `DATE(... AT TIME ZONE AR)` de forma mixta; hay deuda conocida de TZ en cierre de caja/gráficos (ver `../database.txt` y memoria `migration-debt-eventos-timezone`). El summary de entradas sí proyecta a AR (`entradas.ts:445`+), pero `ventas_7d` en el listado de eventos usa `NOW() - INTERVAL '7 days'` sin TZ (`eventos.ts:987`).
- ⚠️ **`entradas_por_unidad` (pack)**: el split de montos por QR usa `roundMoney` y `neto = max(precio - comision - mp_fee, 0)`; redondeos por QR pueden no sumar exactamente lo cobrado en centavos extremos.

## Ver también
- `../FEATURES.md`
- `pagos-checkout.md` — reserva de stock (`checkout_sessions`), confirmación de pago y emisión
- `checkin-qr.md` — uso del `qr_code`/`clave_corta` y paso `valida → usada`
- `consumibles-barra.md` — `barra_stock` + flags `stock_ilimitado`/`agotado` (que NO aplican a entradas)
- `../database.txt` — modelo de stock, tablas críticas, queries
