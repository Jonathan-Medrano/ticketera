# Features — Modelo de datos / Prisma (overview técnico)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta capa
Esquema y migraciones de la DB: **PostgreSQL en Supabase**, accedida vía **Prisma**. Single source of truth de la estructura. Canónico: `backend/prisma/schema.prisma` + `backend/prisma/migrations/` (su Dockerfile corre `prisma migrate deploy` al arrancar cada máquina Fly → es lo que se aplica a prod). El workspace mantiene **3 copias sincronizadas** del schema (`backend/prisma/`, `platea/prisma/`, `prisma/`) porque los sub-repos despliegan por separado.

## Estructura y dominios (tablas críticas → módulo)
Modelos en `backend/prisma/schema.prisma`. Mapeo de las tablas críticas a su módulo dueño:

| Tabla / modelo | schema.prisma | Módulo (fuente de verdad) |
|---|---|---|
| `checkout_sessions` (CheckoutSession) — reservas, source of truth de locks de stock | `:688` | [`features/pagos-checkout.md`](../features/pagos-checkout.md) |
| `processed_webhooks` (ProcessedWebhook) — idempotencia de webhooks MP | `:739` | pagos-checkout |
| `eventos` (Evento), `evento_tandas` (EventoTanda), `evento_fechas` (EventoFecha) | `:581`, `:606`, `:623` | [`features/entradas.md`](../features/entradas.md) |
| `entrada_categorias` (EntradaCategoria) — stock por categoría (`stock`/`stock_disponible`) | `:633` | entradas |
| `entradas` (Entrada) — tickets emitidos (compra confirmada) | `:758` | entradas |
| `evento_addons` / `evento_addon_ventas`, `tickets_fisicos*` (preimpresos), `evento_ventas_snapshot` | `:804`, `:892`/`:919`, `:653` | entradas |
| `barras` (Barra), `consumibles` (Consumible) | `:960`, `:975` | [`features/consumibles-barra.md`](../features/consumibles-barra.md) |
| `barra_stock` (BarraStock) — stock de barra (`stock_actual`), `barra_stock_log`, `barra_restock_alertas` | `:995`, `:1013`, `:1505` | consumibles-barra |
| `consumibles_ventas` (ConsumiblesVenta) + items/resoluciones, `consumibles_canje_auditoria`, `consumible_promociones` | `:1031`/`:1071`/`:1084`, `:1436`, `:1525` | consumibles-barra / checkin-qr |
| `usuarios` (Usuario), `roles` (Rol) | `:226`, `:247` | [`features/auth-onboarding.md`](../features/auth-onboarding.md) |
| `empresas` (Empresa) — tenant raíz (incluye `aprobada`, fees) | `:128` | auth-onboarding / super-admin |
| `compradores` (Comprador), `login_tokens`, `password_reset_tokens`, `email_verification_codes` | `:261`, `:288`, `:301`, `:326` | auth-onboarding |
| `usuarios_roles` / `usuarios_permisos` (RBAC) | en `roles`/`usuarios` rels | auth-onboarding |
| `platform_admin_users` + `platform_admin_*` (relationship, closure, capability/revenue grants, overrides, impersonation) | `:345`, `:396`–`:496` | [`features/super-admin.md`](../features/super-admin.md) |
| `platform_sale_allocations`, `platform_marketplace_fee_default`, `platform_messages` + dismissals | `:496`, `:526`, `:553`/`:570` | super-admin |
| `platform_settings` (PlatformSetting) — config global de plataforma | `:1686` | super-admin |
| `*payment_accounts` (PlatformPaymentAccount, EmpresaPaymentAccount), `empresa_marketplace_fee_override` | `:365`, `:1222`, `:1253` | pagos-checkout / super-admin |
| `refund_manual_case*` (cases, items, events, consumible items) | `:1108`–`:1222` | pagos-checkout |
| `marketing_campanas` / `marketing_envios` / `marketing_segmentos*` / `marketing_codigos_descuento*` / `marketing_oauth_account` | `:1271`–`:1404` | [`features/marketing.md`](../features/marketing.md) |
| `referidos_programa` / `referido` | `:1404`, `:1417` | revendedores/marketing |
| `audit_log` (AuditLog), `error_log` (ErrorLog) | `:1456`, `:1477` | transversal |
| `rate_limit_buckets` (RateLimitBucket), `storage_cleanup_run`, `delivery_dispatch_attempts`, `buyer_phone_verification_challenges`, `soporte_mensajes`, `waitlist_entries`, `empleado_actividad`, `landing_announcements` | `:1650`, `:1560`, `:1625`, `:1601`, `:1585`, `:862`, `:1545`, `:1664` | transversal |

## Específico de la capa (migraciones, patrones, gotchas)

### Flujo de cambios de schema (OBLIGATORIO)
1. Editar `backend/prisma/schema.prisma` (canónico).
2. `cd backend && npx prisma migrate dev --name <slug>` → crea `backend/prisma/migrations/<ts>_<slug>/`.
3. `node scripts/sync-prisma-schemas.mjs --write` (o `npm run prisma:sync:write`) → copia schema a `platea/prisma/` y `prisma/`, y migraciones a `prisma/` (root). **platea NO lleva migraciones.**
4. Verificar drift: `npm run prisma:sync:check` (exit 1 si hay drift).
5. Commit en sub-repo `backend/` + root. El push a `backend/` dispara deploy Fly → corre `migrate deploy`.

### Convenciones de migración (Postgres, no MariaDB)
- **Constraints sobre tablas con datos en prod → `NOT VALID`** (aplica a escrituras nuevas sin escanear filas legacy), para que `migrate deploy` no falle ni bloquee el arranque del backend.
- Migraciones **idempotentes**: `IF NOT EXISTS`, o `DO $$ ... pg_constraint ...` para constraints.
- SQL crudo (CHECK, índices especiales) que Prisma no expresa: hand-authorear `backend/prisma/migrations/<ts>_<slug>/migration.sql` con timestamp posterior a la última migración, y sincronizar igual.
- **Gotcha de outage**: una migración que falla bloquea el `CMD` del contenedor = caída. Confirmar antes de pushear cambios destructivos/riesgosos.

### Clientes y locks (definidos en backend, relevantes al modelo)
- Pooler (`prisma`, 6543) para queries cortas; directo (`prismaDirectUrl`, 5432) para `FOR UPDATE`, advisory locks, tx largas y `migrate deploy`. Detalle: [`backend/features.md`](../backend/features.md).
- Locks de stock viven sobre `checkout_sessions` + `entrada_categorias.stock_disponible` + `barra_stock.stock_actual`.

## Ver también
- Índice: [`FEATURES.md`](../FEATURES.md)
- Módulos (fuente de verdad): `features/*.md`
- Capa backend: [`backend/features.md`](../backend/features.md) · Capa frontend: [`platea/features.md`](../platea/features.md)
- Docs de dominio: `database.txt`, `queries-criticas.txt`; agente: `backend/db-agent.md`
