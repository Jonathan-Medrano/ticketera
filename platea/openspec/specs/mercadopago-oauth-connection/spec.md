# Mercado Pago OAuth Connection Specification

## Purpose

Define how a company connects, reconnects, and disconnects its Mercado Pago collection account through OAuth without manually entering secret tokens.

## Requirements

### Requirement: OAuth-based company connection

The system MUST allow an authorized company dashboard user to initiate Mercado Pago OAuth from a `Conectar Mercado Pago` action. The company MUST authorize its own Mercado Pago account, and the system MUST persist the resulting connection scoped to that company without exposing raw credentials in read models.

#### Scenario: Start OAuth connection

- GIVEN a company dashboard user with permission to edit payment settings
- WHEN the user starts the Mercado Pago connection flow
- THEN the system returns or redirects to a Mercado Pago OAuth authorization URL for that company
- AND the flow is tied to the company context that initiated it

#### Scenario: Complete OAuth callback successfully

- GIVEN a company started the Mercado Pago OAuth flow
- WHEN Mercado Pago redirects back with a valid authorization code
- THEN the system exchanges the code for the company connection credentials
- AND stores the connection for that company
- AND marks the company payment connection for readiness validation

#### Scenario: Reconnect replaces prior company authorization

- GIVEN a company already has a connected Mercado Pago account
- WHEN an authorized dashboard user reconnects via OAuth
- THEN the prior authorization is replaced by the new company connection
- AND the company readiness is re-evaluated from the new connection state

### Requirement: Safe connection visibility

The dashboard MUST be able to read the company connection status and display actionable connection guidance without exposing raw OAuth secrets, refresh tokens, or internal provider errors.

#### Scenario: Dashboard reads connected account state

- GIVEN a company with an existing Mercado Pago connection
- WHEN the dashboard requests payment-connection data
- THEN the response includes connection status, masked account identity or label, and validation timestamps
- AND excludes raw access tokens and refresh tokens

#### Scenario: OAuth callback fails or is rejected

- GIVEN a company started the OAuth flow
- WHEN Mercado Pago returns an error or the callback exchange fails
- THEN the system stores or returns a stable failure outcome for the company connection
- AND the company does not become sellable

### Requirement: Disconnect company account

The system MUST allow an authorized company dashboard user to disconnect the Mercado Pago account from the company without deleting unrelated platform fee policy.

#### Scenario: Disconnect removes sellable connection

- GIVEN a company currently connected to Mercado Pago
- WHEN an authorized dashboard user disconnects the payment account
- THEN the Mercado Pago company connection is removed or deactivated
- AND the company readiness becomes non-sellable
- AND the platform fee policy remains intact
