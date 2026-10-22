# Features — Frontend / Next.js (overview técnico)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta capa
App **Next.js 16 (App Router, React 19, TypeScript)** en `platea/`. NO llama al backend desde el browser: usa **BFF** (`app/api/*` agrega auth headers y proxea al Express) y **SSR directo** desde server components. Cuatro superficies separadas por route group, ruteo multi-tenant por subdominio vía `proxy.ts`.

## Estructura y dominios (resumen + link a superficies/módulos)
Route groups bajo `platea/app/`:

| Superficie | Route group / rutas | Rollup de superficie | Módulos relacionados |
|---|---|---|---|
| Landing pública | `app/(marketing)/` | `app/(marketing)/features.md` *(pendiente)* | marketing, auth-onboarding |
| Dashboard / backoffice empresa | `app/(empresa)/` | `app/(empresa)/features.md` *(pendiente)* | entradas, consumibles-barra, pagos-checkout, checkin-qr, revendedores, auth-onboarding, marketing |
| Consola del dueño (plataforma) | `app/(super-admin)/` + `app/(superadmin)/` | `app/(super-admin)/features.md` *(pendiente)* | super-admin |
| Storefront público del tenant | `app/t/[tenant]/` (alias `app/[tenant]/`) | `app/t/[tenant]/features.md` *(pendiente)* | entradas, consumibles-barra, pagos-checkout, auth-onboarding |

Rutas públicas sueltas fuera de los grupos: `app/checkout/`, `app/pago/`, `app/mis-tickets/`, `app/evento/`, `app/revendedor/`, `app/consumibles/`, `app/unsubscribe/`, `app/auth/`.

> Nota: los rollups de superficie (`features.md` por route group) todavía **no existen** — `FEATURES.md` los lista como mapa a completar. La fuente de verdad sigue siendo `features/*.md`.

## Específico de la capa (infra, patrones, gotchas)

### Patrón BFF (`app/api/*` + `lib/backend-proxy.ts`)
- El browser pega a una route handler de Next (`app/api/<dominio>/route.ts`); ésta agrega `x-internal-secret` + `x-user` (+ contexto de actor) y reenvía al Express vía `proxyToBackend()` (`lib/backend-proxy.ts:60`).
- Subárbol de API espeja los dominios del backend: `app/api/{auth,dashboard,cobros,consumibles,entradas,eventos,escanear,equipo,roles,compradores,revendedor(es),reconciliacion,reembolsos,sitio-venta,marketing,preimpresos,configuracion,tenant,webhooks,client-errors,landing-announcement,platform,...}`.
- `app/api/platform/*` cubre la consola del dueño (empresas, usuarios, comisiones-overrides, audit/error-logs, storage, perf, fees, impersonate, aprobación).
- `app/api/internal/revalidate-tenant/route.ts` — revalidación on-demand de cache del tenant (`lib/revalidate-tenant`).

### SSR directo
- Server components llaman al Express sin pasar por el browser vía `fetchBackendFromServer()` / helpers en `lib/server-backend.ts` (+ `lib/backend-proxy.ts`). Para data del dashboard/storefront que se renderiza en el servidor.

### Middleware de ruteo (`platea/proxy.ts`)
- Subdominio `{tenant}.dominio` → reescribe a `/t/[tenant]/*` (`proxy.ts:87-92`) y setea header `x-tenant-path`.
- Guards de redirect a nivel edge: a `/login` si no hay sesión, a verificación de email, a `/pendiente-aprobacion` si la empresa no está aprobada, a rotación de password, y al home correcto de la consola de plataforma (`proxy.ts:99-136`).

### Providers (React context)
- `components/session-provider.tsx` — NextAuth session.
- `components/theme-provider.tsx` — tema/branding.
- `components/loading-provider.tsx` — estado de carga global.
- Tenant: `components/tenant/tenant-provider.tsx`, `tenant-buyer-session-provider.tsx`, `cart-provider.tsx`, `consumibles-cart-provider.tsx` (carritos de entradas y de barra, sesión de comprador).

### Guards / auth helpers
- `lib/dashboard-auth.ts` — `getCachedSession` (cachea `auth()` por request), `requireDashboardSession` (`:17`), `requireDashboardHomeSession` (`:72`): gating de server components del dashboard.
- `lib/buyer-auth.ts` / `lib/buyer-token-auth.ts` — sesión de comprador (credenciales y magic-token).
- `lib/permisos.ts` — espejo de permisos RBAC en el front. `lib/internal-actor-routing.ts` — routing por tipo de actor. `lib/redirect-whitelist.ts` / `lib/csrf-origin.ts` — hardening de redirects/origin.

### Formatters compartidos (OBLIGATORIO)
- `lib/format.ts` — `formatMoney`/`formatInt` (ARS, es-AR) y `formatDate`/`formatDateTime`/`formatTime` fijados a `America/Argentina/Buenos_Aires`. Usar SIEMPRE estos; NO rolear `toLocaleString`/`Intl.DateTimeFormat` locales.

### Otros
- `lib/tenant*.ts` — host/slug/branding/secciones del storefront. `lib/host-domains.ts` — resolución de dominios raíz.
- Webhooks entran por `lib/mercadopago-webhook.ts` / `lib/resend-webhook.ts` (verificación de firma antes de reenviar al backend).
- `lib/prisma.ts` en front: solo para lecturas server-side puntuales (la fuente de verdad de mutaciones es el backend).

## Ver también
- Índice: [`FEATURES.md`](../FEATURES.md)
- Módulos (fuente de verdad): `features/*.md`
- Capa backend: [`backend/features.md`](../backend/features.md) · Capa datos: [`prisma/features.md`](../prisma/features.md)
- Docs de dominio: `frontend.txt`, `bff-next-api.txt`, `tenant.txt`; agente: `platea/frontend-agent.md`
