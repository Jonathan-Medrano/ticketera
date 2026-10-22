# Features — Backend / API Express (overview técnico)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta capa
API HTTP en **Express 4 + TypeScript** sobre **Prisma/Postgres (Supabase)**. Sirve a la app Next vía el patrón BFF (recibe headers `x-internal-secret` + `x-user`); aloja los jobs cron, el stock locking transaccional y el motor de pagos/webhooks. Entrypoint `backend/src/index.ts`; routers montados en `backend/src/routes/index.ts` bajo `/api`.

## Estructura y dominios (resumen + link a módulos)
Routers montados en `routes/index.ts`. Casi todo el dashboard pasa por `internalDashboardGuards = [verifyInternal, requireAuth, requireInternalDashboardActorMiddleware]` (`routes/index.ts:39`).

| Dominio / área técnica | Archivos clave | Módulo(s) (fuente de verdad) |
|---|---|---|
| Eventos / categorías / tandas / emisión | `routes/eventos.ts`, `routes/entradas.ts`, `routes/preimpresos.ts`, `routes/addons.ts`, `routes/sitio-venta.ts` | [`features/entradas.md`](../features/entradas.md) |
| Consumibles / barra / POS | `routes/consumibles.ts`, `routes/barras.ts`, `routes/vender.ts`, `routes/canjear.ts`, `routes/ventas.ts`, `routes/promociones.ts`, `routes/pos.ts`; lib `consumibles-sales.ts`, `consumibles-redeem.ts`, `consumibles-public-flow.ts` | [`features/consumibles-barra.md`](../features/consumibles-barra.md) |
| Checkout / cobros / Mercado Pago / reembolsos | `routes/cobros.ts`, `routes/tenant.ts` (checkout B2C), `routes/webhooks.ts`, `routes/reembolsos.ts`, `routes/reconciliacion.ts`; lib `mp-refund.ts`, `mercadopago-oauth.ts`, `payment-accounts.ts`, `marketplace-fee.ts`, `fee-billing.ts`, `refund-manual.ts` | [`features/pagos-checkout.md`](../features/pagos-checkout.md) |
| Check-in / escaneo / canje QR | `routes/escanear.ts`, `routes/canjear.ts`; lib `escanear-export-workbook.ts` | [`features/checkin-qr.md`](../features/checkin-qr.md) |
| Revendedores | `routes/revendedores.ts`; lib `revendedores-export-workbook.ts` | [`features/revendedores.md`](../features/revendedores.md) |
| Auth / onboarding / equipo / roles / RBAC | `routes/auth.ts`, `routes/equipo.ts`, `routes/roles.ts`, `routes/compradores.ts`; lib `authz.ts`, `permisos.ts`, `email-verification.ts`, `password-reset.ts`, `password-policy.ts`, `secure-code.ts` | [`features/auth-onboarding.md`](../features/auth-onboarding.md) |
| Marketing (campañas, segmentos, códigos) | `routes/marketing.ts`; lib `google-marketing-oauth.ts`, `resend-retry.ts` | [`features/marketing.md`](../features/marketing.md) |
| Plataforma (consola del dueño) | `routes/platform.ts` + `routes/platform/*` (`dashboard`, `empresas`, `usuarios`, `roles`, `cobros`, `configuracion`, `comisiones-overrides`, `analitica`, `audit-logs`, `error-logs`, `storage`, `perf`, `mensajes`, `me`); lib `platform-governance.ts`, `platform-profit-sharing.ts`, `platform-reporting.ts`, `platform-settings.ts`, `platform-payment-accounts.ts` | [`features/super-admin.md`](../features/super-admin.md) |
| Transversales | `routes/dashboard.ts` (KPIs/cierre caja), `routes/configuracion.ts`, `routes/waitlist.ts`, `routes/client-errors.ts`, `routes/landing-announcement.ts`, `routes/demo-data.ts`, `routes/dashboard/mensajes.ts`, `routes/dashboard/features.ts` | varios |

## Específico de la capa (infra, patrones, gotchas)

### Clientes Prisma (`lib/prisma.ts`)
- `prisma` → **pooler** Supabase (puerto 6543, transaction mode). Default para queries cortas. **NO** sirve para `FOR UPDATE`, advisory locks ni transacciones largas (PgBouncer es incompatible).
- `prismaDirectUrl` → **conexión directa** (puerto 5432, `DIRECT_URL`). Obligatorio para `prisma migrate deploy`, `$queryRaw ... FOR UPDATE`, `pg_advisory_xact_lock` y cualquier tx larga. `lib/prisma.ts:9-17`.

### Stock locking
- Reservas/stock se mutan dentro de `prismaDirectUrl.$transaction(async (tx) => { ... }, { isolationLevel: 'Serializable' })` con `tx.$queryRaw\`SELECT ... FOR UPDATE\`` antes de mutar.
- Paths de alta contención se envuelven en `withSerializableRetry` (maneja `P2034` / serialization failure). Detalle por capability en los módulos de entradas/consumibles/pagos.

### Advisory locks (registry — claves estables, sin colisión)
Tomados con `pg_advisory_xact_lock` (tx-scoped) o `pg_try_advisory_lock` (session-scoped, requiere `pg_advisory_unlock`), siempre sobre `prismaDirectUrl`:
- `4242` → delivery-retry (`services/deliveryRetry.ts:12`)
- `7701` → marketing carrito abandonado (`jobs/marketingCarritoAbandonadoJob.ts:59`)
- `8823` → checkoutCleanup (`services/checkoutCleanup.ts:212`)
- `9001` → platform-governance share mutations (`lib/platform-governance.ts:29`)
- `9002` → platform-profit-sharing (`services/refundSlaAutoApprove.ts:19-20`)
- `9003` → refund SLA auto-approve (`services/refundSlaAutoApprove.ts`)

### Jobs (arrancan en `index.ts:218-223`, intervalos `setInterval`, no node-cron)
- `expiredCheckoutCleanupJob` — libera stock de checkouts vencidos (cada 30 s, `jobs/expiredCheckoutCleanupJob.ts:4`). Lock 8823.
- `deliveryRetryJob` — reintenta entrega de tickets/emails fallidos. Lock 4242.
- `marketingCarritoAbandonadoJob` — campañas de carrito abandonado. Lock 7701.
- `refundSlaAutoApproveJob` — auto-aprueba reembolsos vencidos por SLA. Lock 9003.
- `salesVelocitySnapshotJob` — snapshot de velocidad de ventas (`evento_ventas_snapshot`).
- `storageOrphanCleanupJob` — limpia objetos huérfanos de Supabase Storage.

### Middleware / auth (`middleware/auth.ts`)
- `verifyInternal` — valida `x-internal-secret` con `timingSafeEqual`, rehidrata `req.user` desde `x-user` (`auth.ts:34`). TODA ruta interna del dashboard lo exige.
- `requireAuth` — 401 si no hay `req.user` (`auth.ts:71`).
- `requireInternalDashboardActorMiddleware` (`lib/authz.ts`) — tercer guard del combo dashboard; valida que el actor sea interno (empresa/empleado).
- `parseActorContextHeaders` / `getRequestIp` / `getRequestUserAgent` — contexto de actor desde headers del BFF (`x-actor-kind`, `x-tenant-slug`, `x-client-ip`).
- `errorHandler` (`middleware/errorHandler.ts`) — handler global, montado último (`index.ts:206`).
- Webhooks y client-errors van solo con `verifyInternal` (sin `requireAuth`): `routes/index.ts:93,97`.

### Rate limiting (`express-rate-limit`, montado en `index.ts`)
Limiter global (`index.ts:115`) + limiters específicos por ruta sensible: registro empresa/tenant, reenvío de verify-email, password forgot/reset, tenant auth token, soporte, validar código de descuento, **checkout** (`/tenant/:slug/checkout`, `index.ts:143`), **consumibles vender/canjear** (`index.ts:152,160`), **escanear** (`index.ts:168`), envío/test de campañas marketing (`index.ts:178,188`). Buckets persistentes vía `lib/persistent-rate-limit.ts` (tabla `rate_limit_buckets`).

### Otros patrones
- Webhook idempotente: tabla `processed_webhooks` (evita doble emisión ante reintentos de MP).
- Audit log (`lib/audit-log.ts` → `audit_log`) y error logging (`lib/error-logger.ts`, `error-alert*.ts` → `error_log`).
- Exports a Excel: familia `lib/*-export-workbook.ts` (entradas, consumibles, compradores, revendedores, escaneo, cierre de caja, liquidación, refunds).

## Ver también
- Índice: [`FEATURES.md`](../FEATURES.md)
- Módulos (fuente de verdad): `features/*.md`
- Capa frontend: [`platea/features.md`](../platea/features.md) · Capa datos: [`prisma/features.md`](../prisma/features.md)
- Docs de dominio: `backend.txt`, `queries-criticas.txt`; agente: `backend/backend-agent.md`
