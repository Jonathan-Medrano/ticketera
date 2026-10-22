# Tasks: Unify Password Reset

## Phase 1: Foundation / Persistence

- [x] 1.1 Actualizar persistencia de reset con actor, `token_hash`, TTL 15 min, invalidación y auditoría.
- [x] 1.2 Crear `backend/src/lib/password-reset.ts` con contratos actor-aware y respuesta anti-enumeración.
- [x] 1.3 Ajustar `backend/src/index.ts` para rate limit específico y logging.

## Phase 2: Core Backend Logic

- [x] 2.1 Implementar emisión de tokens con invalidación de previos.
- [x] 2.2 Implementar validación/consumo single-use con expiración.
- [x] 2.3 Modificar `backend/src/routes/auth.ts` para empresa y empleado.
- [x] 2.4 Modificar `backend/src/routes/tenant.ts` para comprador.
- [x] 2.5 Modificar `backend/src/middleware/auth.ts` para preservar IP/User-Agent.

## Phase 3: Proxy / UI Wiring

- [x] 3.1 Modificar `platea/lib/backend-proxy.ts` para reenviar IP y User-Agent.
- [x] 3.2 Modificar `platea/app/(marketing)/login/page.tsx` para recovery de empresa/empleado.
- [x] 3.3 Modificar `platea/app/(marketing)/login/reset/page.tsx` para consumir el flujo unificado.

## Phase 4: Manual Verification / Security Regression

- [x] 4.1 Verificar invalidación de token previo, hash persistido y expiración efectiva.
- [x] 4.2 Verificar empresa, empleado y comprador; inexistente, expirado y reutilizado.
- [x] 4.3 Verificar forwarding real de IP/User-Agent hacia backend y DB.
- [x] 4.4 Verificar rate limit específico y auditoría/logs.
