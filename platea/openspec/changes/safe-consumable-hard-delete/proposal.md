# Proposal: Safe Consumable Hard Delete

## Intent

Hoy el módulo de consumibles expone dos acciones distintas —activar/desactivar y eliminar— pero ambas terminan produciendo el mismo efecto de negocio: un soft delete vía `activo = 0`. Eso vuelve confusa la UX y oculta una decisión de dominio importante. Este cambio distingue explícitamente entre desactivación operativa y borrado real: un consumible solo podrá eliminarse físicamente si no tiene referencias vivas o históricas; si las tiene, el sistema deberá bloquear la eliminación y guiar al usuario a desactivarlo.

## Scope

### In Scope
- Definir la diferencia de comportamiento entre `desactivar` y `eliminar` en consumibles.
- Detectar referencias que impiden hard delete de un consumible.
- Permitir hard delete real cuando el consumible no tenga referencias.
- Bloquear la eliminación con mensaje estable cuando existan referencias.
- Ajustar la UX del módulo de consumibles para reflejar esa diferencia.

### Out of Scope
- Limpieza masiva de datos históricos.
- Soft delete/hard delete de otros módulos como eventos, barras o roles.
- Cambios contables sobre ventas históricas ya registradas.

## Capabilities

### New Capabilities
- `safe-consumable-hard-delete`: eliminación física segura solo para consumibles sin referencias.

### Modified Capabilities
- `consumable-status-management`: la desactivación queda como acción operativa distinta de la eliminación.
- `consumable-admin-ui`: el botón eliminar debe comunicar claramente cuándo borra y cuándo no puede hacerlo.

## Approach

Agregar una validación previa al borrado que consulte si el consumible está referenciado por stock en barras, alertas de reposición, promociones o ventas/items históricas. Si no hay referencias, el backend hará `DELETE` real. Si existen referencias, el backend responderá con un error estable explicando que el consumible no puede eliminarse y que debe desactivarse. El frontend dejará de simular “eliminar = activo 0” y reaccionará según la respuesta real del backend.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/consumibles.ts` | Modified | Reemplazar soft delete por hard delete seguro con validación de referencias |
| `platea/components/dashboard/consumibles-content.tsx` | Modified | Ajustar UX del botón eliminar y manejo de respuesta |
| `backend/src/routes/barras.ts`, `promociones.ts`, `ventas.ts`, `vender.ts` | Reference | Fuentes de verdad para identificar referencias de consumibles |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Borrar un consumible con historial y romper reporting | High | Bloquear hard delete si existe cualquier referencia histórica u operativa |
| Mantener ambigüedad UX entre desactivar y eliminar | Med | Mensaje backend estable + copy clara en frontend |
| Consultas de referencias incompletas | Med | Enumerar explícitamente todas las tablas relevantes en design y tests |

## Rollback Plan

Volver temporalmente al soft delete si se detecta una referencia no considerada, manteniendo el cambio documentado para corregir la detección antes de reactivar el hard delete.

## Dependencies

- Identificación completa de referencias desde `barra_stock`, `barra_restock_alertas`, `consumibles_promociones`, `consumibles_venta_items` y ventas relacionadas.
- Alineación entre backend y frontend sobre cuándo eliminar y cuándo solo desactivar.

## Suggested Phases

1. Modelar reglas de bloqueo por referencias.
2. Implementar hard delete seguro en backend.
3. Ajustar UX del frontend para reflejar la diferencia real entre eliminar y desactivar.
4. Verificar con tests de referencias y casos sin referencias.

## Success Criteria
- [ ] Un consumible sin referencias puede borrarse físicamente.
- [ ] Un consumible con referencias no puede borrarse físicamente.
- [ ] El usuario recibe un mensaje claro cuando debe desactivar en vez de eliminar.
- [ ] La acción de desactivar sigue disponible y separada del borrado real.
