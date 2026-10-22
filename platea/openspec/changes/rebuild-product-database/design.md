# Design: Rebuild Product Database

## Technical Approach

Reconstruir la DB por capas, usando el código actual como fuente primaria del schema y validando cada capa con un slice funcional antes de avanzar. La secuencia técnica será: core auth/tenant → eventos/ticketing → auxiliares comerciales → consumibles.

## Architecture Decisions

### Decision: Code-first schema recovery

**Choice**: Derivar tablas, columnas e índices desde queries y rutas reales.
**Alternatives considered**: Usar `db actualizada.sql` como base principal.
**Rationale**: El dump histórico quedó contaminado por corrupción de engine; el código actual es la fuente de verdad más confiable.

### Decision: Layered rebuild with checkpoints

**Choice**: Reconstrucción por capas, validando cada una antes de seguir.
**Alternatives considered**: Crear todas las tablas de una vez.
**Rationale**: Reduce retrabajo, aísla errores y evita “schema aparentemente completo” pero roto en runtime.

### Decision: Keep `actualizar db.sql` as migration ledger

**Choice**: Registrar sólo diferencias reales pendientes en `actualizar db.sql`.
**Alternatives considered**: Reescribir toda la DB desde un único SQL gigante.
**Rationale**: Mantiene trazabilidad incremental y evita mezclar recuperación completa con cambios puntuales recientes.

### Decision: Preserve lab validation path during rebuild

**Choice**: Mantener slices funcionales básicos (auth/reset) mientras se reconstruyen capas mayores.
**Alternatives considered**: Desarmar la DB y reconstruir todo en una sola ventana.
**Rationale**: Permite seguir verificando comportamiento crítico mientras la base crece.

## Data Flow

Code analysis → derive schema → create/alter tables → seed minimum required data → run functional checkpoint → proceed to next layer.

Core:

`platea/auth.ts` + `routes/auth|tenant|configuracion` ──→ `empresas/usuarios/compradores/roles`

Ticketing:

`routes/eventos|tenant|entradas|dashboard|escanear` ──→ `eventos/fechas/tandas/categorias/entradas/login_tokens/checkout_sessions`

Consumables:

`routes/consumibles|barras|ventas|promociones|canjear|vender` ──→ `consumibles/*`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `actualizar db.sql` | Modify | Agregar DDL pendiente por capa |
| `backend/src/routes/auth.ts` | Reference | Validar dependencias de auth empresa |
| `backend/src/routes/tenant.ts` | Reference | Validar tenant, checkout y login token |
| `backend/src/routes/configuracion.ts` | Reference | Derivar schema real de `empresas` |
| `backend/src/routes/equipo.ts` | Reference | Derivar schema real de `usuarios` |
| `backend/src/routes/roles.ts` | Reference | Derivar tabla `roles` |
| `backend/src/routes/eventos.ts` | Reference | Derivar tablas de eventos y categorías |
| `backend/src/routes/entradas.ts` | Reference | Derivar tabla `entradas` |
| `backend/src/routes/compradores.ts` | Reference | Derivar `login_tokens` y dependencias comerciales |
| `backend/src/routes/consumibles*.ts` | Reference | Derivar tablas de consumibles |
| `platea/auth.ts` | Reference | Validar columnas directas usadas por frontend |

## Interfaces / Contracts

```ts
type RebuildLayer =
  | 'core-auth-tenant'
  | 'events-ticketing'
  | 'commercial-aux'
  | 'consumables'

type FunctionalCheckpoint = {
  layer: RebuildLayer
  routesOrFlows: string[]
  requiredTables: string[]
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Core | login empresa/empleado/comprador, tenant básico, configuración | Requests/manual checks + DB queries |
| Integration | eventos, entradas, checkout, login tokens | Validación por endpoints reales y errores de schema |
| Integration | consumibles, barras, ventas, promociones | Validación por rutas backend y DB consistente |

## Migration / Rollout

1. Exportar snapshot de la DB local actual.
2. Reconstruir o ampliar tablas por capa en `actualizar db.sql`.
3. Aplicar cambios de una sola capa por vez.
4. Ejecutar checkpoint funcional de esa capa.
5. Solo continuar si no hay errores de tabla/columna faltante.

No se asume migración de datos históricos reales desde la DB corrupta.

## Open Questions

- [ ] ¿Queremos reconstruir sólo schema + seed mínima o también datasets demo más ricos por módulo?
- [ ] ¿Conviene separar `actualizar db.sql` por bloques etiquetados por capa para aplicación controlada?
