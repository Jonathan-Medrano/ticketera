# Design: Redesign Dashboard Home

## Technical Approach

Rediseñar `components/dashboard/dashboard-content.tsx` como una home operativa que consuma el contrato completo del resumen del dashboard. La ola actual se concentra en dos piezas faltantes: un filtro por evento integrado al querystring y una tira/carrusel liviano para `eventos_activos`. `app/(empresa)/dashboard/page.tsx` seguirá siendo la frontera server que lee `searchParams`, consulta backend y pasa props tipadas al client component. `DashboardContent` seguirá manejando interacción local con `useSearchParams`, `useRouter` y `usePathname`, pero reorganizará la parte superior para que el foco por evento y la agenda activa sean señales reales de operación.

## Architecture Decisions

| Decisión | Opciones | Elección y tradeoff |
|---|---|---|
| Dirección visual | Hero estático / home con foco operativo por evento | Mantener la cabina operativa actual, pero sumar foco por evento y agenda activa arriba del pliegue. Tradeoff: más densidad en la cabecera, pero mejor orientación. |
| Filtro de evento | Ignorar contrato backend / integrarlo en querystring | Integrar `evento` en `searchParams` y props server->client. Tradeoff: más tipado y wiring, pero cero cambios de backend. |
| Eventos activos | Lista vertical simple / carrusel liviano horizontal | Tira horizontal con scroll-snap y controles propios. Tradeoff: evita dependencias nuevas, pero exige cuidar accesibilidad manualmente. |
| Próximo evento | Mantener card aislada / integrarla con agenda activa | Mantener señal destacada sin competir con la tira de eventos. Tradeoff: requiere evitar duplicación narrativa. |
| Implementación | Nueva primitive reusable / solución acotada al home | Resolver dentro de `dashboard-content.tsx` con helpers livianos. Tradeoff: menor reutilización inmediata, mayor velocidad y menor alcance. |

## Data Flow

`app/(empresa)/dashboard/page.tsx`
-> lee `desde`, `hasta` y `evento` desde `searchParams`
-> obtiene resumen desde backend con esos parámetros
-> normaliza datos, permisos y filtro activo
-> entrega props a `DashboardContent` incluyendo:
   1. métricas
   2. ventas por día
   3. ventas por evento
   4. últimas ventas
   5. próximo evento
   6. eventos disponibles
   7. eventos activos destacados
   8. período y filtro activo

`components/dashboard/dashboard-content.tsx`
-> lee querystring actual con `useSearchParams`
-> actualiza `evento`, `desde` y `hasta` con `router.replace`
-> renderiza:
   1. hero contextual
   2. tira/carrusel de eventos activos
   3. filtros de fecha + evento
   4. métricas
   5. analítica
   6. actividad reciente

No cambia ningún contrato de datos; sólo se empieza a consumir el contrato ya existente.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/redesign-dashboard-home/design.md` | Modify | Reencuadra el diseño técnico al alcance real del home. |
| `openspec/changes/redesign-dashboard-home/tasks.md` | Modify | Define tareas de integración frontend del contrato ya existente. |
| `openspec/changes/redesign-dashboard-home/proposal.md` | Modify | Alinea intención y alcance con el pedido actual. |
| `openspec/changes/redesign-dashboard-home/specs/dashboard-home-redesign/spec.md` | Modify | Formaliza filtro por evento y eventos activos en home. |
| `app/(empresa)/dashboard/page.tsx` | Modify | Agrega `evento` a `searchParams` y tipa nuevas props de resumen. |
| `components/dashboard/dashboard-content.tsx` | Modify | Integra selector por evento y tira/carrusel de eventos activos. |

## Interfaces / Contracts

Se conservan las props actuales de `DashboardContent`:
- `session`
- `metricas`
- `ventasPorDia`
- `ventasPorEvento`
- `ultimasVentas`
- `proximoEvento`
- `periodo`

Se amplían con:
- `eventos`
- `eventosActivos`
- `filtroEvento`

Helpers internos sugeridos:
- `formatDateLong()`
- `MetricCard()`
- `EmptyAnalyticsState()`
- `EventSpotlightRail()` o helper equivalente dentro del mismo archivo.

La refactorización debe concentrarse en la integración visual/funcional del home, no en permisos ni backend.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Functional | Filtros de fecha y evento siguen actualizando querystring | Verificación manual en browser. |
| Functional | Toggle de ingresos sigue ocultando/mostrando monto | Verificación manual de interacción. |
| Functional | El filtro `evento` impacta métricas, gráficos y últimas ventas con el mismo backend | Verificación manual de respuesta del resumen. |
| Functional | La tira/carrusel permite navegar eventos activos sin perder legibilidad | Verificación manual de controles y scroll. |
| Visual | Hero, carrusel, métricas y columnas mantienen jerarquía en mobile/desktop | Revisión manual responsive. |
| Visual | `proximo_evento` y `eventos_activos` no duplican el mismo mensaje | Review manual de jerarquía y microcopy. |
| Content QA | Cada bloque tiene propósito distinto y no repite información | Review manual contra spec. |

No se ve infraestructura de tests UI; esta ola depende de validación manual focalizada.

## Migration / Rollout

No migration required. El rollout es un reemplazo visual/funcional del home del dashboard sobre el mismo contrato de datos.

## Open Questions

- [ ] Evaluar en otra ola si conviene extraer una primitive reutilizable de carousel para otras superficies del dashboard.
- [ ] Confirmar más adelante si conviene destacar alertas reales (stock bajo, eventos hoy, eventos agotándose) cuando backend exponga más señales.
