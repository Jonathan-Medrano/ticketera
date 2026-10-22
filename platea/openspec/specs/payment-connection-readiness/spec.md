# Payment Connection Readiness Specification

## Purpose

Define the stable readiness contract when sellability depends on both a valid company Mercado Pago OAuth connection and a resolvable owner-controlled marketplace fee.

## Requirements

### Requirement: Readiness requires a valid company connection

The system MUST keep a company non-sellable until that company has a valid Mercado Pago connection state suitable for collecting payments. The public storefront MAY remain visible, but checkout MUST remain blocked while readiness is not sellable.

#### Scenario: Company without OAuth connection

- GIVEN a company has no connected Mercado Pago account
- WHEN readiness is requested by dashboard or storefront
- THEN the returned status is non-sellable
- AND the checkout flow is blocked before sale side effects occur

#### Scenario: Company connection pending validation

- GIVEN a company has completed OAuth but the connection has not yet been validated as sellable
- WHEN readiness is requested or checkout starts
- THEN the company remains non-sellable
- AND the system returns a stable reason indicating validation is still pending or unsuccessful

### Requirement: Readiness includes owner fee availability

The system MUST only treat a company as sellable when the payment connection is valid and the owner-controlled marketplace fee can be resolved for that sale context.

#### Scenario: Missing owner fee blocks sellability

- GIVEN a company has a valid Mercado Pago connection
- AND the platform fee policy cannot be resolved
- WHEN readiness is requested or checkout starts
- THEN the company is treated as non-sellable
- AND the sale does not start

#### Scenario: Valid connection and fee enable sales

- GIVEN a company has a valid Mercado Pago connection
- AND the owner-controlled marketplace fee is resolvable
- WHEN readiness is requested
- THEN the company becomes sellable
- AND checkout can create the Mercado Pago payment artifact

### Requirement: Stable readiness contract for clients

Dashboard and public clients MUST consume a stable readiness contract derived from the same backend source of truth, while tenant dashboards receive actionable connection guidance and public storefronts receive sellability guidance only.

#### Scenario: Dashboard receives actionable state

- GIVEN a company is not sellable because Mercado Pago is not connected
- WHEN the dashboard requests readiness
- THEN the response includes a stable machine-readable non-sellable state
- AND the response can drive a `Conectar Mercado Pago` call to action

#### Scenario: Public storefront receives non-sellable visibility

- GIVEN a company is not sellable
- WHEN the public storefront payload is requested
- THEN the site remains visible
- AND purchase actions are disabled or rejected consistently from the same readiness contract
