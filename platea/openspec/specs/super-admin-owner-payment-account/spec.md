# Super Admin Owner Payment Account Specification

## Purpose

Define how the platform owner configures the owner-side Mercado Pago account from the super-admin console.

## Requirements

### Requirement: Owner payment account management

The system MUST provide a super-admin-only configuration surface where the owner can view and update the owner-side Mercado Pago account used by the platform.

#### Scenario: Super-admin opens owner payment account settings

- GIVEN an authenticated super-admin
- WHEN the owner payment account settings are requested
- THEN the system returns the current owner payment account state
- AND excludes raw secrets from read models

#### Scenario: Super-admin updates owner payment account

- GIVEN an authenticated super-admin
- WHEN the owner submits valid Mercado Pago account configuration for the platform account
- THEN the configuration is persisted for the owner account
- AND the owner can later read the resulting masked state from the super-admin console

### Requirement: Owner account management is isolated from tenant seller accounts

The platform owner account configuration MUST NOT overwrite or impersonate the Mercado Pago connections already linked to tenant companies.

#### Scenario: Owner updates own account without modifying tenant connections

- GIVEN one or more companies already have their own Mercado Pago seller connections
- WHEN the super-admin updates the owner payment account
- THEN tenant seller connections remain unchanged
- AND company readiness continues to depend on each tenant's own seller connection plus its resolved company fee
