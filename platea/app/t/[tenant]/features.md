# Features — Storefront público del Tenant (rollup)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta superficie
La tienda pública de cada empresa (`t/[tenant]/*`, servida por subdominio `{tenant}.dominio.com` vía rewrite): donde el público ve eventos, compra entradas y consumibles, paga, se loguea como comprador y consulta sus compras. Branding por tenant; sesión de comprador propia (no NextAuth).

## Qué ofrece (resumen + link al módulo fuente de verdad)
| Área | Módulo (detalle) | Estado |
|---|---|---|
| Ver evento + categorías/tandas/stock | [entradas](../../../../features/entradas.md) | ✅ |
| Comprar entradas (carrito → checkout) | [entradas](../../../../features/entradas.md), [pagos-checkout](../../../../features/pagos-checkout.md) | ✅ |
| Comprar consumibles (catálogo público → checkout) | [consumibles-barra](../../../../features/consumibles-barra.md), [pagos-checkout](../../../../features/pagos-checkout.md) | ✅ |
| Pago Mercado Pago (redirect + estados éxito/pendiente/error) | [pagos-checkout](../../../../features/pagos-checkout.md) | ✅ |
| Login comprador (password + magic-token) + reset/rotación | [auth-onboarding](../../../../features/auth-onboarding.md) | ✅ |
| Mis tickets / mis compras de consumibles (QR + clave) | [entradas](../../../../features/entradas.md), [consumibles-barra](../../../../features/consumibles-barra.md) | ✅ |
| Link de referido revendedor (`?ref=`) | [revendedores](../../../../features/revendedores.md) | ✅ |

## Específico de esta superficie (lo que NO está en un módulo)
- **Layout + shell + guards** (`t/[tenant]/layout.tsx`): envuelve todo en `TenantSurfaceShell` (provee branding y `useTenant()` — sin él las páginas que lo consumen explotan). Aplica `enforceBuyerPasswordRotation(tenant)` salvo en `/actualizar-password` y `/auth/*` (evita loop). Favicon por tenant vía `generateMetadata` (`favicon_url`/`logo_url`).
- **Home del tenant** (`t/[tenant]/page.tsx` → `tenant-home.tsx`): lista los eventos activos del tenant (`/api/tenant/{tenant}/eventos`, revalidate 60).
- **Páginas de la tienda**: `evento/[id]/` (detalle + compra), `checkout/` (entradas), `consumibles/` + `consumibles/[id]/` + `consumibles/checkout/` (barra pública), `consumibles/mis-compras/`, `mis-tickets/`, `pago/{exito,pendiente,error}/`, `informacion/[slug]/` (páginas de info del sitio de venta), `soporte/`, `configuracion/` (preferencias del comprador).
- **Auth del comprador** (`t/[tenant]/auth/`, `auth/token/`, `auth/reset/`, `actualizar-password/`): sesión cookie-based tenant-scoped, NO NextAuth (ver módulo auth-onboarding). El login es la PUERTA antes de poder rotar contraseña.
- **Branding**: el contenido/estilo del storefront lo edita la empresa en `(empresa)/dashboard/sitio-venta`; esta superficie solo lo consume.

## Ver también
- `../../../../FEATURES.md` (índice maestro) y los módulos linkeados arriba.
- Editor que alimenta esta tienda: `../../(empresa)/features.md` (sección "Sitio de venta").
