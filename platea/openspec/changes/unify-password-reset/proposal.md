# Proposal: Unify Password Reset

## Intent

Unificar la recuperación y reseteo de contraseña para empresa, empleado y comprador con una única política backend de seguridad.

## Scope

### In Scope
- Servicio backend unificado para solicitar y consumir password reset.
- Soporte para `empresa | empleado | comprador`.
- Tokens hasheados, TTL de 15 minutos, un solo uso e invalidación previa.
- Rate limit, respuesta anti-enumeración, validación consistente y auditoría básica.

### Out of Scope
- Rediseño visual completo de las pantallas.
- MFA / passkeys / verificación por SMS.
- Hardening avanzado de observabilidad o panel administrativo de auditoría.

## Capabilities

### New Capabilities
- `password-reset`: recuperación y reseteo unificado para empresa, empleado y comprador.
- `password-reset-security`: políticas de expiración, invalidación, hashing y anti-enumeración.

### Modified Capabilities
- None

## Approach

Mantener UX separada por contexto y centralizar emisión, validación, expiración, invalidación y consumo de tokens en un servicio backend compartido.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/lib/password-reset.ts` | New | Lógica unificada para forgot/reset |
| `backend/src/routes/auth.ts` | Modified | Delegación empresa y empleado |
| `backend/src/routes/tenant.ts` | Modified | Delegación comprador |
| `backend/src/index.ts` | Modified | Rate limit específico |
| `platea/lib/backend-proxy.ts` | Modified | Forward IP/User-Agent |
| `platea/app/(marketing)/login/reset/page.tsx` | Modified | Selector empresa/empleado |
| `db actualizada.sql` / `actualizar db.sql` | Modified | Schema unificado de tokens |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Regresiones en flujos existentes | Med | Mantener URLs públicas actuales |
| Cambio de esquema de tokens | High | Migración controlada y tabla efímera |
| Ambigüedad entre empresa y empleado | Med | Selector explícito en UI |

## Rollback Plan

Restaurar rutas anteriores, volver al esquema de tokens previo y retirar el servicio compartido.

## Dependencies

- Base MySQL accesible
- Envío de mails vía Resend

## Success Criteria

- [ ] Empresa, empleado y comprador pueden solicitar reset bajo una política común.
- [ ] Los tokens expiran a los 15 minutos, son de un solo uso y no se guardan en texto plano.
- [ ] Un nuevo request invalida tokens activos previos del mismo actor.
- [ ] El sistema no enumera cuentas por respuestas públicas.
- [ ] Existe rate limit específico para forgot/reset.
