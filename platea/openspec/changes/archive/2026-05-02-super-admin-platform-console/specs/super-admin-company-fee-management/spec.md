# Super Admin Company Fee Management Specification

## Purpose

Define how the platform owner configures marketplace commission per company from the super-admin console.

## Requirements

### Requirement: Owner-only company fee configuration

The system MUST allow only a super-admin to define or update the marketplace fee retained by Platea for a specific company.

#### Scenario: Super-admin sets company commission

- GIVEN an authenticated super-admin
- WHEN the super-admin saves a commission for a company
- THEN the new owner-controlled fee is persisted for that company
- AND future readiness/checkout resolution uses that persisted company fee

#### Scenario: Non-super-admin cannot set company commission

- GIVEN an authenticated non-super-admin user
- WHEN that user attempts to update a company marketplace fee
- THEN the request is rejected
- AND the company fee remains unchanged

### Requirement: Company fee configuration is visible but remains owner-controlled

The system MUST preserve the existing rule that tenant companies can see the active marketplace fee as read-only information, while the super-admin console remains the only editable surface.

#### Scenario: Tenant dashboard still sees read-only fee

- GIVEN a company has an owner-configured marketplace fee
- WHEN the tenant payment settings are requested
- THEN the company sees the active fee as informational data
- AND the tenant cannot edit it from the tenant dashboard
