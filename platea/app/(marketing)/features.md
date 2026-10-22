# Features — Marketing / Landing pública (rollup)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta superficie
La cara pública de TICKETERA: la landing comercial (`(marketing)`) que vende el producto, capta registros y aloja las páginas legales/soporte. No vende entradas (eso es el storefront del tenant) ni gestiona nada (eso es el dashboard).

## Qué ofrece (resumen + link al módulo fuente de verdad)
| Área | Módulo (detalle) | Estado |
|---|---|---|
| Registro de empresa (CTA "Crear mi espacio gratis") | [auth-onboarding](../../../features/auth-onboarding.md) | ✅ |
| Login empresa/empleado + tab registro + Google | [auth-onboarding](../../../features/auth-onboarding.md) | ✅ |
| Verificación de email (código + magic-link) | [auth-onboarding](../../../features/auth-onboarding.md) | ✅ |
| Barra de anuncio editable de la home | [super-admin](../../../features/super-admin.md) | ✅ |
| Sección del módulo marketing en la landing (showcase) | [marketing](../../../features/marketing.md) | ✅ |

## Específico de esta superficie (lo que NO está en un módulo)
- **Estructura de la home** (`(marketing)/homepage.tsx`): hero → features → showcase módulo marketing → reconciliación → CTA final. Componentes en `platea/components/marketing/` (`landing-hero.tsx`, `landing-features.tsx`, `landing-marketing-module.tsx`, `landing-reconciliation.tsx`).
- **Navbar + footer públicos**: `platea/components/navbar.tsx`, `platea/components/marketing/marketing-footer.tsx`.
- **Barra de anuncio**: render en `homepage.tsx:42` (`AnnouncementBar`), datos vía `loadAnnouncement()` → `/api/landing-announcement` (no-store). El contenido lo edita el super-admin (ver módulo).
- **CTAs de registro/descubrimiento**: `homepage.tsx` linkea a `/login?tab=registro` (registro) y `/contacto` ("Hablar con alguien antes").
- **Pricing inline (no hay página de planes ni billing)**: el único precio expuesto es la copy de la home — "Sin tarjeta hasta tu primera venta · Comisión 4% por ticket vendido · Mercado Pago a tu cuenta" (`homepage.tsx`). NO existe sistema de planes/tiers ni billing (ver nota en `marketing` y `super-admin`).
- **Login con tabs login/registro**: `(marketing)/login/page.tsx` — tab inicial según `?tab=registro` o prefill de onboarding Google (`page.tsx:344`). El detalle del flujo está en el módulo auth-onboarding.
- **Gates post-registro / estados de acceso**: `(marketing)/pendiente-aprobacion/` (empresa registrada esperando aprobación del super-admin), `(marketing)/sin-acceso/` (empleado sin permiso), `(marketing)/verificar-email/` (confirmar email). Lógica de gate en el módulo auth-onboarding.
- **Páginas estáticas**: `(marketing)/terminos/`, `(marketing)/privacidad/`, `(marketing)/contacto/`, `(marketing)/soporte/` — usan `static-marketing-page-shell.tsx`.

> Nota: no hay descubrimiento/listado público de tenants en esta superficie. Cada tenant se accede por su subdominio (rewrite a `t/[tenant]`), no desde la landing. Si llegara a hacer falta un buscador de productoras, sería un candidato a feature nueva.

## Ver también
- `../../../FEATURES.md` (índice maestro) y los módulos linkeados arriba.
