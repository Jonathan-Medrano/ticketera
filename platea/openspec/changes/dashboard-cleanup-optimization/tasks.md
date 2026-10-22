# Tasks: dashboard cleanup and optimization

1. [x] Confirmar consumidores y contratos antes de borrar la ruta duplicada y los métodos stale.
   - Archivo(s): `app/(empresa)/dashboard/consumibles/barras/page.tsx`, `app/(empresa)/dashboard/barras/page.tsx`, `app/api/cobros/mercadopago/route.ts`, `openspec/changes/archive/2026-05-02-owner-controlled-mercadopago-oauth/{proposal.md,design.md,tasks.md}`
   - Validación: queda evidencia en repo/docs de que `/dashboard/barras` es la ruta canónica y de que `POST/PATCH /api/cobros/mercadopago` no tienen consumidores vigentes.
   - Evidencia: `components/dashboard/sidebar.tsx` navega a `/dashboard/barras`; `app/(empresa)/dashboard/barras/page.tsx` y `app/(empresa)/dashboard/consumibles/barras/page.tsx` son funcionalmente equivalentes; no aparecieron referencias de código a `/dashboard/consumibles/barras` fuera del propio archivo y artefactos generados. Para Mercado Pago, `components/dashboard/cobros-content.tsx` solo usa `GET`, `DELETE` y `POST /oauth/start`, mientras `openspec/changes/archive/2026-05-02-owner-controlled-mercadopago-oauth/design.md` define que `route.ts` debía quedar en `GET/DELETE` y `verify-report.md` confirma que `POST/PATCH` manuales ahora devuelven `405`.

2. [x] Consolidar la resolución de sesión/permisos del dashboard en un helper server-side y eliminar `auth()` redundante en cascada.
   - Archivo(s): `lib/server-backend.ts`, `app/(empresa)/dashboard/layout.tsx`, `app/(empresa)/dashboard/page.tsx`, `lib/dashboard-auth.ts` (nuevo si hace falta)
   - Validación: home y layout siguen resolviendo redirects/permisos igual que hoy, y los fetch server-side reciben `x-user` sin volver a llamar `auth()`.
   - Evidencia: `lib/dashboard-auth.ts` centraliza la resolución y guards del dashboard; `layout.tsx` y `page.tsx` consumen ese helper; `lib/server-backend.ts` reutiliza `getCachedSession()` para evitar una tercera resolución independiente de `auth()` dentro del mismo request.

3. [x] Canonizar `/dashboard/barras` y convertir `/dashboard/consumibles/barras` en redirect explícito o removerlo si la confirmación previa lo habilita.
   - Archivo(s): `app/(empresa)/dashboard/barras/page.tsx`, `app/(empresa)/dashboard/consumibles/barras/page.tsx`, `components/dashboard/sidebar.tsx`
   - Validación: toda navegación interna entra por `/dashboard/barras`, los deep links viejos no rompen y el permiso `ver_consumibles` mantiene el mismo comportamiento.
   - Evidencia: `components/dashboard/sidebar.tsx` ya navegaba a `/dashboard/barras`; la ruta duplicada quedó reducida a `redirect("/dashboard/barras")`, preservando deep links sin mantener lógica duplicada.

4. [x] Refactorizar `components/dashboard/dashboard-content.tsx` en piezas/helpers más chicos y eliminar código muerto como `ocupacionProximoEvento`.
   - Archivo(s): `components/dashboard/dashboard-content.tsx`, `components/dashboard/dashboard-*.tsx` o `components/dashboard/dashboard-content/*` (nuevos helpers/subcomponentes si hacen falta)
   - Validación: el home renderiza igual, sin cambios de UX, con menor acoplamiento y sin estados/helpers muertos.
   - Evidencia: se extrajeron secciones presentacionales a `components/dashboard/dashboard-content-sections.tsx` y se eliminó el cálculo muerto `ocupacionProximoEvento`, dejando `dashboard-content.tsx` enfocado en estado, filtros y fetching.

5. [x] Reducir el costo del modal del evento usando datos ya disponibles o un payload resumido en vez del detalle completo actual.
   - Archivo(s): `components/dashboard/dashboard-content.tsx`, `app/api/eventos/[id]/route.ts` o backend/proxy relacionado si hiciera falta ajustar contrato
   - Validación: al abrir el modal muestra la misma información útil, evita over-fetch/re-fetch innecesario y no queda corto de datos para el caso actual.
   - Evidencia: `components/dashboard/dashboard-content.tsx` ahora cachea el detalle por `eventoId` en memoria del client component y reutiliza la respuesta cuando se reabre el modal del mismo evento, evitando refetchs repetidos en la misma sesión de UI sin tocar el contrato actual.

6. [x] Remover `POST` y `PATCH` stale del proxy de Mercado Pago y cerrar la ola con una pasada de regresión funcional del dashboard.
   - Archivo(s): `app/api/cobros/mercadopago/route.ts`, `app/(empresa)/dashboard/cobros/page.tsx`, `components/dashboard/cobros-content.tsx`
   - Validación: `GET`/`DELETE` y `oauth/start`/`oauth/callback` siguen operativos, `POST/PATCH` dejan de exponerse, y quedan verificados navegación interna, redirects/permisos y comportamiento del modal.
   - Evidencia: `app/api/cobros/mercadopago/route.ts` quedó solo con `GET` y `DELETE`; el consumidor activo en `components/dashboard/cobros-content.tsx` ya usaba `GET`, `DELETE` y `POST /oauth/start`; además se corrió `eslint` sobre los archivos modificados sin reportes.
