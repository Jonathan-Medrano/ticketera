# Design: Safe Consumable Hard Delete

## Technical Approach

Separar explícitamente dos acciones que hoy están mezcladas: desactivar un consumible y eliminarlo. El backend dejará de hacer soft delete en `DELETE /consumibles/:id` y primero verificará referencias operativas e históricas del consumible. Si no hay referencias, ejecutará `DELETE` físico. Si existen referencias, devolverá un error estable indicando que debe usarse la desactivación. El frontend dejará de simular que eliminar es equivalente a `activo = 0` y reaccionará según la respuesta real del backend.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Mantener desactivación como acción separada | Reemplazar delete por solo desactivar | El usuario ya distingue ambas acciones; hay que respetar el significado y no mentir en UX. |
| Bloquear hard delete si existe cualquier referencia | Borrar igual y confiar en cascadas o dejar datos huérfanos | Las referencias históricas/operativas no pueden romperse por una acción administrativa. |
| Verificar referencias en aplicación antes de borrar | Intentar delete directo y capturar errores DB | El sistema necesita devolver mensajes de negocio claros, no errores genéricos de integridad. |
| Remover el item del listado solo cuando el delete fue real | Simular `activo = 0` localmente tras delete | Si el delete no fue físico, la UI no debe fingir otra cosa. |

## Data Flow

Delete consumible:
1. Usuario confirma eliminar
2. Frontend llama `DELETE /api/consumibles/:id`
3. Backend verifica referencias en tablas relevantes
4. Si no hay referencias → `DELETE FROM consumibles`
5. Si hay referencias → `400` con error estable
6. Frontend:
   - éxito → remueve item de la lista
   - bloqueo → muestra mensaje y sugiere desactivar

Toggle activo:
1. Usuario usa switch/acción de estado
2. Frontend llama update/toggle
3. Backend actualiza `activo`
4. El registro sigue existiendo

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/src/routes/consumibles.ts` | Modify | Reemplazar soft delete por hard delete seguro con chequeo de referencias |
| `platea/components/dashboard/consumibles-content.tsx` | Modify | Diferenciar UX de delete vs deactivate y mostrar mensajes adecuados |
| `backend/src/routes/barras.ts` | Reference | Fuente para referencias de `barra_stock` y alertas asociadas |
| `backend/src/routes/promociones.ts` | Reference | Fuente para referencias en promociones |
| `backend/src/routes/ventas.ts` | Reference | Fuente para referencias históricas en ventas/items |

## Interfaces / Contracts

### Stable blocked-delete error

```json
{
  "error": "No se puede eliminar el consumible porque tiene referencias activas o históricas. Desactivalo en su lugar."
}
```

### Reference sources to check

El backend debe considerar al menos:
- `barra_stock`
- `barra_restock_alertas`
- `consumibles_promociones` (`consumible_ids`)
- `consumibles_venta_items`

Si cualquier referencia existe, el delete se bloquea.

## Validation & Error Handling

- Consumible inexistente → `404`.
- Consumible con referencias → `400` con mensaje estable de bloqueo.
- Consumible sin referencias → `200 { ok: true }` y delete físico.
- El toggle de estado no debe verse afectado por esta regla; sigue operando sobre `activo`.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Integration | Delete sin referencias | Crear consumible aislado y verificar eliminación física |
| Integration | Delete bloqueado por stock | Crear referencia en `barra_stock` y esperar `400` |
| Integration | Delete bloqueado por historial | Crear referencia en `consumibles_venta_items` y esperar `400` |
| Integration | Toggle activo sigue separado | Cambiar `activo` y verificar que no borra el registro |
| UI | Frontend remueve item solo en hard delete exitoso | Validación de comportamiento del listado |

## Migration / Rollout

Fase 1: backend distingue delete real vs bloqueo por referencias.  
Fase 2: frontend deja de simular soft delete al eliminar.  
Fase 3: tests cubren referencias y separación conceptual entre desactivar y borrar.

## Open Questions

- [ ] Confirmar si `consumibles_promociones.consumible_ids` debe bloquear siempre el delete o si promociones inactivas podrían excluirse.
- [ ] Confirmar si una referencia histórica cancelada igualmente debe bloquear el delete (recomendación: sí, por trazabilidad).
