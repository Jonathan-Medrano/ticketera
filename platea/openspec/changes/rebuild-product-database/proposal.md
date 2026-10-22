# Proposal: Rebuild Product Database

## Intent

Reconstruir el schema real de Platea de forma segura y gradual para volver a tener backend + frontend consistentes con el código actual, sin depender de una DB mínima de laboratorio.

## Scope

### In Scope
- Reconstruir el schema por capas: core auth/tenant, eventos/ticketing, auxiliares comerciales y consumibles.
- Ampliar tablas existentes incompletas (`empresas`, `usuarios`) y recrear tablas ausentes críticas (`roles`, `eventos`, `entradas`, etc.).
- Validar cada capa con checkpoints funcionales reales antes de seguir con la siguiente.

### Out of Scope
- Migración de datos reales históricos desde la DB corrupta.
- Rediseño funcional de módulos existentes.
- Ajustes de infraestructura externos al schema (hosting, DNS, dominio, etc.).

## Capabilities

### New Capabilities
- `database-core-rebuild`: reconstrucción del schema base para auth, tenant y configuración.
- `database-ticketing-rebuild`: reconstrucción de eventos, categorías, entradas, checkout y login tokens.
- `database-consumables-rebuild`: reconstrucción de consumibles, barras, stock, promociones y ventas.

### Modified Capabilities
- None

## Approach

Reconstrucción por capas core-first, validando cada una con slices funcionales: primero auth/tenant, después eventos/ticketing y por último consumibles. El código actual será la fuente primaria del schema; `actualizar db.sql` y `db actualizada.sql` solo sirven como apoyo secundario.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/auth.ts` | Modified | Depende de tablas core sanas |
| `backend/src/routes/tenant.ts` | Modified | Depende de branding, checkout y ticketing |
| `backend/src/routes/eventos.ts` | Modified | Requiere schema de eventos completo |
| `backend/src/routes/entradas.ts` | Modified | Requiere ticketing completo |
| `backend/src/routes/equipo.ts` | Modified | Requiere `usuarios` y `roles` completos |
| `backend/src/routes/consumibles*.ts` | Modified | Requieren schema de consumibles |
| `platea/auth.ts` | Modified | Depende directo de `empresas`, `usuarios`, `compradores`, `roles` |
| `actualizar db.sql` | Modified | Debe concentrar migraciones pendientes reales |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Schema incompleto pero “aparentemente usable” | High | Validar cada capa con checkpoints funcionales |
| Rehacer tablas raíz múltiples veces | Med | Seguir orden core-first y congelar baseline |
| Tomar un dump roto como verdad | High | Priorizar código real y DB actual sobre `db actualizada.sql` |

## Rollback Plan

Respaldar el estado actual antes de cada capa y reconstruir en pasos pequeños; si una capa falla, volver al snapshot previo de esa etapa en vez de seguir encadenando cambios rotos.

## Dependencies

- MariaDB/MySQL local operativa
- Acceso al código actual backend/frontend como fuente de schema
- Validación manual por capa

## Success Criteria

- [ ] Auth empresa/empleado/comprador y tenant básico funcionan con schema real reconstruido.
- [ ] Eventos, entradas y checkout quedan navegables y consistentes con el código actual.
- [ ] El subdominio consumibles queda operativo sin tablas faltantes ni errores de engine.
