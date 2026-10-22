# Owner-Controlled Marketplace Fee Specification

## Purpose

Define how the marketplace commission is controlled by the platform owner and applied to company sales without allowing tenant companies to edit that commission.

## Requirements

### Requirement: Platform-owned fee policy

The system MUST resolve the marketplace fee from a platform-controlled policy source independent of the company payment-account connection. Tenant company flows MUST NOT be able to define or mutate that fee policy.

#### Scenario: Checkout resolves owner fee

- GIVEN a company with a valid connected Mercado Pago account
- AND the platform has a configured marketplace fee policy
- WHEN the company starts a sale
- THEN the checkout flow resolves the marketplace fee from the platform-controlled policy
- AND does not read that fee from tenant-submitted payment configuration

#### Scenario: Company cannot edit owner fee

- GIVEN a company dashboard user with payment-settings access
- WHEN the user loads or edits Mercado Pago payment settings
- THEN the company can see the active marketplace fee only as informational data
- AND the company cannot submit changes to the marketplace fee policy

### Requirement: Fee policy survives company connection changes

The platform fee policy MUST remain separate from company OAuth connection lifecycle so that reconnecting or disconnecting a company account does not implicitly change the owner commission.

#### Scenario: Reconnect keeps fee policy unchanged

- GIVEN a company has an active marketplace fee policy from the platform owner
- WHEN the company reconnects Mercado Pago through OAuth
- THEN the resolved fee policy for future sales remains the same unless the owner changes it separately

#### Scenario: Disconnect keeps owner fee configuration

- GIVEN a company had a previously connected Mercado Pago account
- AND the platform owner fee policy exists for that company or globally
- WHEN the company disconnects Mercado Pago
- THEN the owner fee configuration remains stored
- AND the company still cannot sell until a valid payment connection exists again

### Requirement: Fee applied to company checkout target

When a company is sellable, the system MUST create the Mercado Pago payment artifact using the company as the collection target and the owner-controlled marketplace fee as the platform charge.

#### Scenario: Ready company creates preference with owner fee

- GIVEN a company is ready to sell through a connected Mercado Pago account
- AND the owner-controlled marketplace fee is 4 percent
- WHEN checkout creates the Mercado Pago payment preference
- THEN the collection target remains the connected company account
- AND the preference includes the marketplace fee corresponding to the owner policy
