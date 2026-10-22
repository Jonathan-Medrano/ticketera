# Features — Empresa / Dashboard backoffice (rollup)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta superficie
El backoffice multi-tenant de la empresa (`(empresa)/dashboard/*`): donde el dueño y su equipo crean eventos, venden, operan la barra/POS, gestionan revendedores y equipo, hacen marketing y miran reportes. Toda la superficie está detrás de sesión NextAuth (`requireDashboardSession`) y filtrada por permisos RBAC.

## Qué ofrece (resumen + link al módulo fuente de verdad)
| Área (sección sidebar) | Módulo (detalle) | Estado |
|---|---|---|
| Eventos / Ventas / Compradores | [entradas](../../../features/entradas.md) | ✅ |
| Consumibles / Barras / POS | [consumibles-barra](../../../features/consumibles-barra.md) | ✅ |
| Escanear (puerta + barra) | [checkin-qr](../../../features/checkin-qr.md) | ✅ |
| Revendedores | [revendedores](../../../features/revendedores.md) | ✅ |
| Marketing | [marketing](../../../features/marketing.md) | ✅ |
| Reembolsos / Reconciliación | [pagos-checkout](../../../features/pagos-checkout.md) | ✅ |
| Equipo / Roles (RBAC) | [auth-onboarding](../../../features/auth-onboarding.md) | ✅ |
| Configuración / conexión Mercado Pago | [pagos-checkout](../../../features/pagos-checkout.md), [auth-onboarding](../../../features/auth-onboarding.md) | ✅ |

## Específico de esta superficie (lo que NO está en un módulo)
- **Layout + guard**: `(empresa)/dashboard/layout.tsx` — `requireDashboardSession()` (gate de sesión + aprobación), carga `permisos`, `mensajes` de plataforma y `features` (flags `revendedorHabilitado` / `consumiblesHabilitado` / `posMovilHabilitado` / `esPrueba`). Renderiza `Sidebar`, banner de impersonation y banner de mensajes de plataforma.
- **Sidebar y secciones** (`platea/components/dashboard/sidebar.tsx:60-113`): agrupado en "Vista general", "Venta y público", "Operación del evento", "Equipo y control", "Demo", + "Configuración". Cada item gateado por `permiso` (RBAC) y por `featureFlags` (`sidebar.tsx:194-201`: revendedores, consumibles/barras, POS móvil, datos demo se ocultan según flags de la empresa).
- **Home / vista general** (`dashboard/page.tsx` → `dashboard-content.tsx`): KPIs, analítica e insights del negocio (`dashboard-analytics-section.tsx`, `dashboard-insights-section.tsx`). Es agregación cross-módulo, no detalle de un módulo.
- **Editor del sitio de venta** (`dashboard/sitio-venta/` → `sitio-venta-content.tsx`, `sitio-venta-sections.tsx`): branding y contenido del storefront público del tenant; permiso `editar_configuracion`. Es lo que se ve en la superficie `t/[tenant]`.
- **Reconciliación** (`dashboard/reconciliacion/` → `reconciliacion-content.tsx`): cuadre de recaudación / detección de descuadres; permiso `ver_recaudacion`. (El cobro/split vive en pagos-checkout.)
- **Datos demo** (`dashboard/demo-data/` → `demo-data-section.tsx`): solo visible si `esPrueba` — seed de datos de prueba.
- **Banners de plataforma**: `platform-messages-banner.tsx` (mensajes del super-admin) e `impersonation-banner.tsx` (cuando el super-admin entra como la empresa).

## Ver también
- `../../../FEATURES.md` (índice maestro) y los módulos linkeados arriba.
- Storefront público resultante: `../t/[tenant]/features.md`.
