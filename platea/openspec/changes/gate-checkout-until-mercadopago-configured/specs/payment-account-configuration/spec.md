# Payment Account Configuration Specification

## Purpose

Define how each company configures and maintains its own Mercado Pago collection account, while the platform applies a stable marketplace commission per sale.

## Requirements

### Requirement: Company-scoped payment account

The system MUST manage payment account configuration per company. A company MUST be able to have no account or one active Mercado Pago account record used to collect funds for that company, and secret credentials MUST NOT be exposed in public or dashboard read models.

#### Scenario: Create initial account configuration

- GIVEN a company without a payment account
- WHEN an authorized dashboard user submits Mercado Pago account data
- THEN the system stores it scoped to that company
- AND the company becomes `pending_validation`

#### Scenario: Replace existing account configuration

- GIVEN a company with an existing configured account
- WHEN an authorized dashboard user updates the Mercado Pago credentials or account identity
- THEN the previous readiness MUST be re-evaluated
- AND the company becomes `pending_validation` until validation finishes

### Requirement: Stable marketplace commission policy

The platform MUST be able to define a stable marketplace commission per sale independently from the company payment-account credentials. The commission SHOULD be readable by backend sale flows without exposing internal calculation details to public clients.

#### Scenario: Platform defines a commission policy

- GIVEN a company with or without a configured payment account
- WHEN the platform defines or updates the marketplace commission for that company
- THEN the commission policy is stored independently from company secrets
- AND future ready-to-sell payments use that commission

#### Scenario: Company account remains the collection target

- GIVEN a company with a validated Mercado Pago account and a configured commission
- WHEN a sale is later initiated
- THEN the payment is collected for the company account
- AND the marketplace commission remains an additional platform charge, not a replacement target

### Requirement: Validation result persistence

The system MUST persist the latest validation outcome for the company payment account and SHOULD persist a stable failure reason when validation fails or the account is blocked.

#### Scenario: Validation succeeds

- GIVEN a company with submitted Mercado Pago data
- WHEN validation confirms the company can collect payments
- THEN the account validation result is stored as successful
- AND downstream readiness can become `ready_to_sell`

#### Scenario: Validation fails

- GIVEN a company with submitted Mercado Pago data
- WHEN validation rejects the credentials or account state
- THEN the system stores the failed outcome with a stable reason
- AND downstream readiness MUST NOT be `ready_to_sell`
