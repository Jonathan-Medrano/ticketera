# Proposal: Dashboard Cleanup and Optimization

## Intent

Reducir deuda técnica visible en el dashboard de empresa sin cambiar el producto ni los contratos core del backend. La exploración ya validó código muerto en `components/dashboard/dashboard-content.tsx`, una ruta duplicada/huerfana para barras, resolución redundante de `auth()` entre layout/page/server fetch, un home client-side sobredimensionado y un modal que refetchea `/api/eventos/:id` con más datos de los que muestra. También existe un proxy stale en `app/api/cobros/mercadopago/route.ts` que todavía expone `POST` y `PATCH` pese a que el flujo vigente es OAuth y la documentación ya marca 405.

## Scope

### In Scope
- Eliminar código muerto y consolidar la ruta canónica de barras del dashboard.
- Reducir llamadas redundantes de `auth()` en el home del dashboard y ordenar el acceso server-side al backend.
- Refactorizar `components/dashboard/dashboard-content.tsx` en piezas más pequeñas, manteniendo el comportamiento actual.
- Evitar over-fetch del modal del evento usando datos ya disponibles o un payload acotado al resumen operativo.
- Alinear `app/api/cobros/mercadopago/route.ts` con el flujo OAuth vigente y remover métodos stale/deprecados.

### Out of Scope
- Rediseñar visualmente el dashboard o cambiar UX más allá de cleanup/canonicalización.
- Cambiar reglas de permisos, contratos SQL o lógica del backend fuera de endpoints ya existentes.
- Rehacer módulos ajenos al home (`eventos`, `consumibles`, `cobros`) salvo el ajuste mínimo de integración.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- None.

## Approach

Trabajar en una ola acotada de cleanup técnico: canonizar `/dashboard/barras`, encapsular la sesión para que layout/page/fetch no la resuelvan en cascada, extraer subcomponentes/helpers del home, y reemplazar el fetch detallado del modal por un contrato más chico o por reuso de datos ya presentes. El proxy de Mercado Pago debe reflejar únicamente el flujo vigente (`GET`, `DELETE`, `oauth/start`, `oauth/callback`).

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `components/dashboard/dashboard-content.tsx` | Modified | Cleanup, split y reducción de acoplamiento/over-fetch. |
| `app/(empresa)/dashboard/page.tsx` | Modified | Simplifica auth/data loading del home. |
| `app/(empresa)/dashboard/layout.tsx` | Modified | Fuente canónica de sesión para dashboard. |
| `lib/server-backend.ts` | Modified | Evita resolver `auth()` redundante en fetch server-side. |
| `app/(empresa)/dashboard/barras/page.tsx` | Modified | Mantiene ruta canónica. |
| `app/(empresa)/dashboard/consumibles/barras/page.tsx` | Removed/Modified | Se elimina o redirige la duplicación. |
| `app/api/cobros/mercadopago/route.ts` | Modified | Remueve métodos stale alineados al flujo OAuth. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Deep links externos a `/dashboard/consumibles/barras` | Med | Preferir redirect antes de borrar si no hay evidencia de tráfico cero. |
| Romper auth en server components | Med | Validar redirects, permisos y headers `x-user` en home y barras. |
| Consumidor oculto de `POST/PATCH /api/cobros/mercadopago` | Med | Verificar repo y documentación antes de quitar métodos. |

## Rollback Plan

Revertir cambios en home, proxy y canonicalización de barras. Si la ruta duplicada se elimina y aparece uso real no contemplado, restaurarla temporalmente o dejar redirect permanente.

## Dependencies

- Contrato actual de `/api/dashboard/resumen` y `/api/eventos/:id`.
- Evidencia documental del cambio OAuth/405 en `owner-controlled-mercadopago-oauth`.

## Success Criteria

- [ ] El home del dashboard mantiene comportamiento visible con menos acoplamiento y sin `auth()` redundante en cascada.
- [ ] `/dashboard/barras` queda como ruta canónica y la duplicación deja de existir o redirige explícitamente.
- [ ] El modal del evento deja de pedir más datos de los que renderiza.
- [ ] `app/api/cobros/mercadopago/route.ts` ya no expone `POST/PATCH` stale.
