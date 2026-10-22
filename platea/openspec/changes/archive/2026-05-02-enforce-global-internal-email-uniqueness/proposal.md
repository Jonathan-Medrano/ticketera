# Proposal: Enforce Global Internal Email Uniqueness

## Intent

Hoy Platea trata los emails internos de forma inconsistente. Las cuentas empresa y super-admin ya se resuelven desde un login general por email, mientras que los empleados pueden darse de alta con un email repetido en otra empresa porque su alta solo valida `email + empresa_id`. Eso deja un sistema ambiguo: una misma dirección puede representar múltiples identidades internas, pero el flujo de login y recuperación de contraseña no está preparado para distinguirlas. Este cambio establece una regla explícita: los emails de actores internos deben ser globalmente únicos en toda la plataforma.

## Scope

### In Scope
- Definir y aplicar la unicidad global de email para actores internos:
  - empresa
  - empleado/usuario interno
  - super-admin
- Validar esa regla en altas, ediciones y flujos relevantes de autenticación/recuperación.
- Ajustar mensajes de error para explicar el conflicto de email ya tomado.
- Preparar la persistencia para que la regla quede alineada con el modelo real de login.

### Out of Scope
- Unificar identidad entre actores internos y compradores.
- Permitir un mismo empleado operar en múltiples empresas con una sola identidad multi-tenant.
- Rediseñar el login para pedir tenant/empresa al actor interno.

## Capabilities

### New Capabilities
- `global-internal-email-uniqueness`: un email interno representa una sola identidad interna en toda la plataforma.

### Modified Capabilities
- `super-admin-auth-surface`: sigue usando login general, pero ahora con garantía de unicidad de email interno.
- `company-registration`: debe rechazar emails internos ya usados por otras identidades internas.
- `team-member-management`: debe impedir altas/ediciones que creen ambigüedad de identidad interna.
- `password-reset`: debe seguir resolviendo actores internos sin ambigüedad por email.

## Approach

Aplicar una regla de dominio consistente sobre el email interno. En vez de permitir que usuarios internos repitan correo entre empresas, el backend validará el email contra todas las tablas de identidades internas antes de crear o actualizar registros. La autenticación y el password reset seguirán usando email simple para actores internos, pero ahora con un modelo que ya no admite colisiones lógicas.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/auth.ts` | Modified | Alta empresa debe respetar unicidad global de email interno |
| `backend/src/routes/equipo.ts` | Modified | Alta/edición de empleados debe validar colisión global interna |
| `backend/src/lib/password-reset.ts` | Modified | Mantener recuperación interna coherente con unicidad global |
| `platea/auth.ts` / `platea/lib/auth-identities.ts` | Modified | Auth se beneficia de la no ambigüedad explícita |
| `actualizar db.sql` | Modified | Preparar constraints o estrategia persistida para la unicidad interna |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bloquear casos reales donde una persona hoy comparte email entre empresas | Med | Validar si existen datos actuales en conflicto antes de endurecer la regla |
| Dejar auth y alta desalineados | High | Implementar la regla en todos los puntos de entrada, no solo en un form |
| Introducir constraints DB antes de limpiar datos existentes | Med | Agregar fase de detección/corrección previa si hay colisiones reales |

## Rollback Plan

Mantener la validación solo a nivel aplicación sin constraint rígido de DB mientras se corrigen conflictos históricos, y retirar el endurecimiento si bloquea datos existentes inesperados.

## Dependencies

- Inventario claro de identidades internas actuales (`empresas`, `usuarios`, `platform_admin_users`).
- Decisión explícita de negocio: un email interno no puede pertenecer a más de una identidad interna.

## Suggested Phases

1. Detectar colisiones existentes y definir la regla exacta.
2. Implementar validaciones globales de email interno en altas/ediciones.
3. Endurecer persistencia/constraints si los datos ya están limpios.
4. Verificar auth y password reset sin ambigüedad.

## Success Criteria

- [ ] Una empresa no puede registrarse con un email ya usado por un empleado o super-admin.
- [ ] Un empleado no puede crearse ni actualizarse con un email ya usado por otra identidad interna.
- [ ] El login interno por email deja de tener ambigüedad estructural.
- [ ] La recuperación de contraseña interna sigue resolviendo un único actor por email.
