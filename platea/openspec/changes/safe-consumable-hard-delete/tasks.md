# Tasks: Safe Consumable Hard Delete

## Phase 1: Backend domain rule

- [ ] 1.1 Identificar en `backend/src/routes/consumibles.ts` todas las referencias que bloquean hard delete de un consumible.
- [ ] 1.2 Reemplazar el soft delete actual de `DELETE /consumibles/:id` por delete físico solo cuando no existan referencias.
- [ ] 1.3 Devolver un error estable y claro cuando existan referencias y la eliminación quede bloqueada.

## Phase 2: Frontend UX alignment

- [ ] 2.1 Modificar `platea/components/dashboard/consumibles-content.tsx` para que eliminar ya no simule `activo = 0` localmente.
- [ ] 2.2 Mostrar un mensaje claro al usuario cuando la eliminación esté bloqueada y deba usar desactivación.
- [ ] 2.3 Mantener la acción activar/desactivar separada y sin mezclarla con el delete.

## Phase 3: Verification

- [ ] 3.1 Escribir tests para hard delete exitoso sin referencias.
- [ ] 3.2 Escribir tests para bloqueo por referencias operativas (`barra_stock`, alertas, promociones o ventas/items`).
- [ ] 3.3 Verificar que toggle activo sigue funcionando como estado y no como borrado.
