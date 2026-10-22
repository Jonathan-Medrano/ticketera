# unified-password-reset Specification

## Purpose

Definir un contrato único para solicitar y consumir password reset para `empresa`, `empleado` y `comprador` con una política homogénea de seguridad.

## Requirements

### Requirement: Solicitud unificada de reset

The system MUST accept password-reset requests for `empresa`, `empleado`, and `comprador` through a unified backend policy. It MUST validate actor context server-side, apply a specific rate limit, return an anti-enumeration public response for unknown accounts, and audit issuance or rejection events.

#### Scenario: Solicitud válida emite reset para empresa
- GIVEN an active `empresa` account exists for the submitted identity
- WHEN a password-reset request is accepted within the rate limit
- THEN the system returns the same public success response
- AND audits a token issuance event for actor `empresa`

#### Scenario: Cuenta inexistente no se enumera
- GIVEN no account exists for the submitted identity and actor context
- WHEN a password-reset request is submitted
- THEN the system returns the same public success response
- AND no usable reset token is created

#### Scenario: Rate limit específico excedido
- GIVEN repeated requests already exceeded the configured reset threshold
- WHEN another password-reset request is submitted for the same actor context
- THEN the system rejects the request with the rate-limit outcome defined for the endpoint
- AND audits the rejection without revealing whether the account exists

### Requirement: Ciclo de vida y consumo del token

The system MUST issue reset tokens with a 15-minute TTL, store only a token hash, invalidate any prior active token for the same actor before issuing a new one, and allow a token to change exactly one password exactly once. The system MUST reject invalid, expired, or already-used tokens with a consistent server-side validation outcome.

#### Scenario: Token válido restablece contraseña
- GIVEN a non-expired unused token for a resolved actor
- WHEN the actor submits a valid new password and confirmation
- THEN the password is updated in the actor’s source table
- AND the token is marked consumed and cannot be reused

#### Scenario: Nuevo token invalida uno previo activo
- GIVEN an actor already has an active reset token
- WHEN a new token is issued for that same actor
- THEN the previous active token becomes unusable
- AND only the newest token remains eligible for reset

#### Scenario: Token vencido o usado falla
- GIVEN a token is expired or already consumed
- WHEN a reset attempt is submitted with that token
- THEN the password is not changed
- AND the system returns the invalid reset outcome defined for token validation
