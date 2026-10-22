# Tasks: Redesign Dashboard Home

## Phase 1: Reframe SDD Artifacts

- [x] 1.1 Verificar en código real si el backend ya soporta filtro por evento y eventos activos en `/api/dashboard/resumen`.
- [x] 1.2 Actualizar `proposal.md` para enfocar el change en el home con carrusel/tira de eventos y filtro por evento.
- [x] 1.3 Actualizar `design.md` y `spec.md` para reflejar el contrato real y la ausencia de una primitive de carousel instalada.

## Phase 2: Server-Side Dashboard Wiring

- [x] 2.1 Ampliar `app/(empresa)/dashboard/page.tsx` para leer `evento` desde `searchParams`.
- [x] 2.2 Reenviar `evento` al backend y tipar `eventos`, `eventos_activos` y `filtros.evento` en la respuesta.
- [x] 2.3 Pasar las nuevas props al client component sin alterar permisos ni shape del resto del resumen.

## Phase 3: Home Event Focus UI

- [x] 3.1 Integrar un selector por evento en `components/dashboard/dashboard-content.tsx` reutilizando la primitive `Select` del proyecto.
- [x] 3.2 Implementar una tira/carrusel liviano para `eventos_activos` sin dependencias nuevas.
- [x] 3.3 Reconciliar `proximo_evento` con la nueva tira para evitar duplicación visual o narrativa.

## Phase 4: Functional Validation

- [ ] 4.1 Verificar manualmente que fecha + evento actualicen querystring con `router.replace`.
- [ ] 4.2 Verificar manualmente que métricas, analítica y últimas ventas respondan al filtro `evento`.
- [ ] 4.3 Revisar responsive y legibilidad del carrusel/tira en mobile y desktop.
