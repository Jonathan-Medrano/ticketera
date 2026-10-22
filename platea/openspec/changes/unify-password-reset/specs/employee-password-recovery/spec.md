# employee-password-recovery Specification

## Purpose

Habilitar recuperación de acceso para `empleado` bajo la misma política centralizada de password reset.

## Requirements

### Requirement: Recuperación de empleado bajo política central

The system MUST allow an `empleado` to request and consume password reset through the shared backend policy, while resolving employee identity server-side and updating only the employee credential record. Employee recovery MUST follow the same TTL, hashing, invalidation, anti-enumeration, validation, and audit rules as other actors.

#### Scenario: Empleado solicita recuperación
- GIVEN an active employee account exists for the submitted identity and resolved company context
- WHEN the employee recovery request is submitted within policy limits
- THEN the system returns the neutral public success response
- AND the request is processed under actor `empleado`

#### Scenario: Reset válido actualiza solo credencial de empleado
- GIVEN a valid unused employee reset token exists
- WHEN the employee submits a valid new password
- THEN the password is updated only in the employee credential source
- AND no `empresa` or `comprador` password is modified

#### Scenario: Contexto actor-token inconsistente
- GIVEN a reset token does not resolve to the employee context presented at consumption time
- WHEN a reset attempt is submitted
- THEN the system rejects the reset as invalid
- AND no password change occurs
