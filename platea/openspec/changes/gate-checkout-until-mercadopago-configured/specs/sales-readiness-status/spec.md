# Sales Readiness Status Specification

## Purpose

Define the stable commercial readiness contract reused by backend, public frontend, and dashboard.

## Requirements

### Requirement: Stable readiness lifecycle

The system MUST derive exactly one stable readiness status per company: `missing_provider`, `pending_validation`, `ready_to_sell`, or `blocked`. New companies without configured provider MUST default to `missing_provider`. `ready_to_sell` MUST only be used after successful payment-account validation. `blocked` MUST override any otherwise sellable state.

#### Scenario: Company without payment provider

- GIVEN a company with no configured payment account
- WHEN readiness is requested
- THEN the returned status is `missing_provider`

#### Scenario: Company blocked after prior success

- GIVEN a company previously able to sell
- WHEN the provider or business policy marks it unavailable for charging
- THEN the returned status is `blocked`
- AND it is no longer sellable

### Requirement: Readiness signals for clients

The system MUST expose readiness status and a stable machine-readable reason to backend consumers, the public tenant experience, and the dashboard. The dashboard SHOULD receive an actionable signal indicating configuration is required, while the public site SHOULD receive a sellability signal without exposing secrets or internal validation details.

#### Scenario: Dashboard requests readiness

- GIVEN a company in `pending_validation`
- WHEN the dashboard requests commercial readiness
- THEN the response includes `pending_validation`
- AND includes a stable reason that can drive setup guidance

#### Scenario: Public site requests readiness

- GIVEN a company that is not `ready_to_sell`
- WHEN the public tenant payload is requested
- THEN the response includes the non-sellable status
- AND indicates the site remains visible but cannot sell
