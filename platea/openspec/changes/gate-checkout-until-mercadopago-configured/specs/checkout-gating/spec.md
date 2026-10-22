# Checkout Gating Specification

## Purpose

Prevent checkout and sale initiation when a company cannot legally or operationally collect payments, and require marketplace commission application on ready-to-sell payments.

## Requirements

### Requirement: Backend checkout gate

The backend MUST block checkout, payment-preference creation, and sale initiation whenever the company readiness is not `ready_to_sell`. When the company is `ready_to_sell`, the backend MUST create payment preferences or equivalent payment artifacts with the configured marketplace commission applied while charging the company's configured account. The gate MUST execute before reserving stock, creating payment artifacts, or confirming sale start, and MUST return a stable rejection reason tied to the readiness state.

#### Scenario: Missing provider blocks checkout

- GIVEN a company in `missing_provider`
- WHEN a checkout or payment-start request is sent
- THEN the backend rejects the request before any sale side effect occurs
- AND the rejection reason is stable and explicit

#### Scenario: Pending validation blocks payment initiation

- GIVEN a company in `pending_validation`
- WHEN a client attempts to create a payment flow
- THEN the backend rejects the request
- AND no payment artifact or reservation is created

#### Scenario: Ready company creates payment with commission

- GIVEN a company in `ready_to_sell` with a configured marketplace commission
- WHEN a client starts checkout
- THEN the backend creates the payment artifact with the marketplace commission applied
- AND the payment charges the company's configured Mercado Pago account

### Requirement: Visible storefront without sales

The public storefront MUST remain accessible for companies that are not `ready_to_sell`, but purchase actions MUST be disabled or rejected consistently. Public and dashboard clients MUST be able to show a clear non-sellable state derived from the same backend readiness contract.

#### Scenario: Public site remains visible while blocked

- GIVEN a company in `blocked`
- WHEN a buyer opens the public site
- THEN catalog and non-checkout pages remain accessible
- AND purchase actions are presented as unavailable with a clear reason

#### Scenario: Direct API bypass is prevented

- GIVEN a company whose public UI disables checkout
- WHEN a client calls the checkout API directly
- THEN the backend returns the same non-sellable rejection
- AND the sale does not start
