# Design: Enforce Global Internal Email Uniqueness

## Technical Approach

Establecer una regla explícita para emails internos: un correo interno puede pertenecer a una sola identidad interna entre `empresas`, `usuarios` y `platform_admin_users`. La implementación empezará en capa de aplicación para cubrir altas, ediciones y flujos de recovery/auth antes de endurecer la persistencia. Esto permite corregir el dominio sin romper datos existentes de golpe. Una vez que la validación esté unificada, el login y password reset internos podrán seguir resolviendo actores por email simple sin ambigüedad lógica.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Tratar empresa, empleado y super-admin como actores internos bajo una misma regla de email | Mantener reglas distintas por tabla | El login interno ya funciona por email simple; reglas distintas generan ambigüedad estructural. |
| Excluir compradores de la unicidad global interna | Unificar compradores también | Compradores ya son tenant-scoped (`email + empresa_slug`); mezclarlos con internos sería otro problema distinto. |
| Implementar primero validación en capa de aplicación | Crear constraint DB inmediata | Es más seguro detectar colisiones y ajustar flujos antes de endurecer la base. |
| Reusar un helper común de “email interno disponible” | Duplicar consultas en auth/equipo/super-admin | Centralizar evita que un punto aplique una regla distinta a otro. |
| Mantener password reset por actorType pero con unicidad garantizada | Rediseñar ahora el recovery interno completo | El problema actual no es el shape del recovery, sino la ambigüedad del email interno repetido. |

## Data Flow

Alta/edición interna:
1. request de empresa / equipo / super-admin
2. normalizar email
3. consultar colisiones en identidades internas
4. si existe otra identidad interna → `409`
5. si no existe → persistir

Auth interno:
1. login general por email
2. resolver identidad interna única
3. autenticación sin colisión entre actor types internos

Password reset interno:
1. request por actorType
2. resolver email
3. la unicidad global evita que otra identidad interna compita por el mismo correo

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/src/routes/auth.ts` | Modify | Validar email interno global en registro de empresa |
| `backend/src/routes/equipo.ts` | Modify | Validar email interno global en alta y edición de empleados |
| `backend/src/lib/password-reset.ts` | Modify | Asegurar coherencia con la nueva regla de unicidad interna |
| `platea/lib/auth-identities.ts` | Modify | Mantener helper de login alineado con identidad interna única |
| `actualizar db.sql` | Modify | Preparar soporte persistido/índices o tabla auxiliar si se decide endurecer DB |

## Interfaces / Contracts

### Validation contract

El sistema debe devolver un error estable de conflicto cuando un email interno ya esté en uso por otra identidad interna.

Ejemplo esperado:

```json
{
  "error": "El email ya está en uso por otra cuenta interna"
}
```

### Internal actor set

La validación de unicidad global aplica a:
- `empresas.email`
- `usuarios.email`
- `platform_admin_users.email`

No aplica a:
- `compradores.email`

## Validation & Error Handling

- Email interno ya usado por empresa/empleado/super-admin → `409` con mensaje estable.
- Edición de empleado al mismo email actual → permitida si no cambia la identidad efectiva.
- Datos históricos en conflicto → reportar antes de aplicar constraint fuerte de DB.
- Buyer con mismo email → no bloquear por esta regla si sigue siendo buyer tenant-scoped.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Detección de colisión entre tipos internos | Helper común de unicidad |
| Integration | Registro empresa rechaza email interno usado | Test API auth |
| Integration | Alta/edición de empleado rechaza email interno usado | Test API equipo |
| Integration | Recovery interno sigue resolviendo un solo actor | Test password reset |
| Auth | Login general sigue resolviendo actor único | Tests de identidad/auth helpers |

## Migration / Rollout

Fase 1: detectar y bloquear nuevas colisiones en capa de aplicación.  
Fase 2: revisar datos existentes y corregir duplicados internos si aparecen.  
Fase 3: evaluar constraint persistido o tabla de identidad interna si hace falta endurecimiento adicional.

## Open Questions

- [ ] Confirmar si existe algún caso de negocio real donde una misma persona deba ser empleado en múltiples empresas con el mismo email bajo el login actual.
- [ ] Decidir si el endurecimiento final se hace con constraints en tablas existentes o con una tabla de identidades internas unificada.
