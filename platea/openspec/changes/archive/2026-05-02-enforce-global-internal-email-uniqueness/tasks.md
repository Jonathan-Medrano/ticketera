# Tasks: Enforce Global Internal Email Uniqueness

## Phase 1: Regla de negocio y helper común

- [x] 1.1 Crear un helper común para consultar si un email interno ya está tomado por `empresas`, `usuarios` o `platform_admin_users`.
- [x] 1.2 Normalizar el email antes de validar colisiones para evitar diferencias triviales de casing/espacios.

## Phase 2: Aplicar la validación en altas y ediciones

- [x] 2.1 Modificar `backend/src/routes/auth.ts` para impedir que una empresa se registre con un email interno ya usado.
- [x] 2.2 Modificar `backend/src/routes/equipo.ts` para impedir crear empleados con emails internos ya usados por cualquier actor interno.
- [x] 2.3 Modificar `backend/src/routes/equipo.ts` para impedir cambiar un empleado a un email interno ya usado por otra identidad interna.
- [x] 2.4 Mantener explícitamente fuera de esta regla a los compradores tenant-scoped.

## Phase 3: Coherencia con auth y password reset

- [x] 3.1 Revisar `platea/lib/auth-identities.ts` para asegurar que el login general se beneficia de la unicidad interna sin rutas ambiguas.
- [x] 3.2 Revisar `backend/src/lib/password-reset.ts` para garantizar que recovery interno sigue resolviendo un único actor por email.

## Phase 4: Verificación

- [x] 4.1 Escribir tests para registro de empresa rechazando emails internos ya usados.
- [x] 4.2 Escribir tests para alta/edición de empleado rechazando emails internos ya usados.
- [x] 4.3 Escribir tests para mantener permitido el caso buyer tenant-scoped.
- [x] 4.4 Escribir tests para auth/recovery sin ambigüedad interna.

### Evidencia Phase 1-2

- Nuevo helper: `backend/src/lib/internal-email.ts` para detectar colisiones entre `empresas`, `usuarios` y `platform_admin_users`.
- `backend/src/routes/auth.ts`, `backend/src/routes/equipo.ts` y `backend/src/routes/configuracion.ts` ya normalizan email y rechazan colisiones internas con error estable.
- La regla sigue excluyendo explícitamente a compradores tenant-scoped.

### Evidencia Phase 4 parcial

- Test nuevo: `backend/src/internal-email-uniqueness.test.ts` cubre conflicto empresa↔empleado, empleado↔empresa/super_admin, edición de empleado con email interno tomado y buyer email permitido.
- `backend/src/password-reset.integration.test.ts` agrega evidencia de recovery interno sin ambigüedad para empresa y empleado con emails internos únicos.
- Verificación ejecutada sin build: `npm test` en `backend/` → `31/31` pasando.
