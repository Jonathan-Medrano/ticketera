# Design: Unify Password Reset

## Technical Approach

Extraer una capa compartida `backend/src/lib/password-reset.ts` para `empresa | empleado | comprador`, mantener las URLs públicas actuales y hacer que las rutas solo deleguen. La UI de marketing sigue separada, pero consume una política común.

## Architecture Decisions

### Decision: Backend unificado

**Choice**: Un solo servicio para request/reset.
**Alternatives considered**: Duplicar lógica por ruta.
**Rationale**: Evita drift de seguridad y concentra reglas críticas.

### Decision: Contrato público compatible

**Choice**: Mantener `/api/auth/password/*` y `/api/tenant/:slug/password/*`.
**Alternatives considered**: Endpoint único público nuevo.
**Rationale**: Minimiza impacto en frontend actual.

### Decision: Token hasheado y efímero

**Choice**: SHA-256 en DB, TTL 15 min, single-use.
**Alternatives considered**: UUID plano persistido.
**Rationale**: Reduce exposición si la DB se filtra.

### Decision: Actor explícito para empresa/empleado

**Choice**: Selector en `/login/reset`.
**Alternatives considered**: Inferir actor por email.
**Rationale**: Evita ambigüedad y errores de resolución.

## Data Flow

`Login/Reset UI` → `Next Route Handler` → `proxyToBackend()` → `verifyInternal` → `password-reset.ts` → `MySQL/Resend`

Forgot:

`UI` → `POST forgot` → resolver actor → invalidar previos → guardar `token_hash` → enviar mail → responder `{ ok: true }`

Reset:

`UI` → `POST reset` → hash del token → validar expiración/uso → actualizar password en tabla origen → marcar `used_at`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/src/lib/password-reset.ts` | Create | Servicio unificado forgot/reset |
| `backend/src/routes/auth.ts` | Modify | Delegar empresa y empleado |
| `backend/src/routes/tenant.ts` | Modify | Delegar comprador |
| `backend/src/index.ts` | Modify | Rate limit específico |
| `backend/src/middleware/auth.ts` | Modify | Captura IP/User-Agent |
| `backend/src/types.ts` | Modify | `requestMeta` |
| `platea/lib/backend-proxy.ts` | Modify | Forward headers reales |
| `platea/app/(marketing)/login/page.tsx` | Modify | Copy actualizado |
| `platea/app/(marketing)/login/reset/page.tsx` | Modify | Selector y payload actor |
| `platea/app/api/**/password/**/route.ts` | Modify | Handlers Next 16 válidos |

## Interfaces / Contracts

```ts
type PasswordResetActor = 'empresa' | 'empleado' | 'comprador'

interface PasswordResetRequestInput {
  actorType: PasswordResetActor
  email: string
  tenantSlug?: string
}

interface PasswordResetConsumeInput {
  token: string
  nuevaPassword: string
  confirmarPassword: string
  actorType?: PasswordResetActor
  tenantSlug?: string
}
```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Manual API | forgot/reset happy path | Requests reales contra backend local |
| Manual DB | invalidación, IP/UA, single-use | Consultas directas a MySQL |
| Manual Security | anti-enumeration y rate limit | Repetición controlada de requests |

## Migration / Rollout

Migrar a `password_reset_tokens` unificada. Como los tokens son efímeros, no se preservan tokens anteriores. En entorno local se usó DB mínima de laboratorio por corrupción del schema original.

## Open Questions

- [ ] Restaurar schema completo local para sacar el ruido de `checkout_sessions`.
- [ ] Agregar tests automatizados mínimos del flujo.
