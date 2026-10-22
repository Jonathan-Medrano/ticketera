# Proposal: Redesign Dashboard Home

## Intent

Reencuadrar el home del dashboard de empresa para resolver el gap real verificado: el backend ya expone filtro por evento y eventos activos destacados, pero el frontend todavía no los usa. El objetivo es mejorar claridad operativa y percepción de producto en `components/dashboard/dashboard-content.tsx` y `app/(empresa)/dashboard/page.tsx` incorporando un filtro de eventos y una tira/carrusel de eventos activos sin tocar contratos del backend ni reglas de permisos.

## Scope

### In Scope
- Mantener la dirección visual de **cabina operativa clara** del home del dashboard.
- Integrar filtro por evento en el home usando el query param existente `evento`.
- Consumir `eventos`, `eventos_activos` y `filtros.evento` ya provistos por `/api/dashboard/resumen`.
- Introducir una superficie destacada tipo carrusel/tira horizontal para eventos activos, con foco en contexto rápido y navegación clara.
- Mantener la funcionalidad existente: filtros de fecha, ocultar ingresos, tabs analíticas y listado de últimas ventas.

### Out of Scope
- Rediseñar sidebar, pantalla de eventos o el resto de rutas del dashboard en esta ola.
- Cambiar endpoints, shape de respuesta, reglas de permisos o lógica SQL del backend.
- Introducir dependencias nuevas de carousel o charting.

## Capabilities

### New Capabilities
- `dashboard-home-event-focus`: El home permite enfocar la lectura operativa sobre un evento puntual desde el propio resumen.

### Modified Capabilities
- `dashboard-home-summary`: El resumen existente conserva datos y acciones, pero suma consumo completo del contrato del backend.
- `dashboard-home-redesign`: La nueva composición visual incorpora eventos activos como señal operativa real en la parte alta del home.

## Approach

Tomar el home actual como base funcional y completarlo con el contrato que hoy está desaprovechado. La página server `app/(empresa)/dashboard/page.tsx` debe empezar a leer `evento` dentro de `searchParams`, reenviarlo al backend y tipar `eventos`, `eventos_activos` y `filtros`. Luego `DashboardContent` debe integrar un selector de eventos consistente con otros módulos del dashboard y una tira/carrusel liviano de eventos activos, implementado sin dependencias nuevas, para que el usuario pueda escanear agenda, ocupación y contexto sin sentir que la home está incompleta.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/redesign-dashboard-home/proposal.md` | Modified | Reencuadra intención y alcance al home con filtro por evento y carrusel. |
| `openspec/changes/redesign-dashboard-home/design.md` | Modified | Documenta integración del contrato existente y resolución del carrusel sin primitive previa. |
| `openspec/changes/redesign-dashboard-home/tasks.md` | Modified | Reemplaza el checklist cerrado anterior por tareas alineadas al pedido actual. |
| `openspec/changes/redesign-dashboard-home/specs/dashboard-home-redesign/spec.md` | Modified | Formaliza filtro por evento y eventos activos en el home. |
| `app/(empresa)/dashboard/page.tsx` | Modified | Amplía consumo server-side de `searchParams` y del contrato del resumen. |
| `components/dashboard/dashboard-content.tsx` | Modified | Incorpora selector por evento y carrusel/tira de eventos activos dentro del home. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Duplicar `proximo_evento` y `eventos_activos` con el mismo mensaje | Med | Redefinir jerarquía para que el carrusel complemente y no repita el bloque superior. |
| Implementar un carrusel custom poco accesible | Med | Resolverlo con scroll-snap, controles explícitos y fallback usable sin JS adicional. |
| Volver opaco el alcance del filtro por evento | Med | Hacer visible en la UI que el filtro impacta métricas, analítica y actividad reciente. |
| Desalinear artifacts SDD con la implementación real | High | Actualizar proposal, design, tasks y spec antes de tocar código productivo. |

## Rollback Plan

Si el filtro por evento o la tira de eventos activos no mejoran la lectura, revertir `app/(empresa)/dashboard/page.tsx` y `components/dashboard/dashboard-content.tsx` a la versión anterior. El contrato del backend permanece estable, así que el rollback es puramente de integración visual/funcional del frontend.

## Dependencies

- El endpoint `/api/dashboard/resumen` y su contrato actual (`evento`, `eventos`, `eventos_activos`, `filtros`).
- La primitive `components/ui/select.tsx` ya presente en el proyecto.
- Validación manual de desktop/mobile con datos reales o mockeados del resumen.

## Success Criteria

- [ ] La proposal deja explícito que el backend ya soporta filtro por evento y el trabajo faltante está en frontend.
- [ ] El alcance queda limitado al home del dashboard y sus artifacts SDD.
- [ ] Se conserva el contrato funcional existente sin cambios de backend.
- [ ] La solución incorpora filtro por evento y una tira/carrusel de eventos activos sin depender de una librería nueva.
