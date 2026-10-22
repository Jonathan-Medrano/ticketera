# Super Admin Auth Surface Specification

## Purpose

Define how a platform super-admin is recognized and allowed into the global owner console using the same general login entrypoint as regular company and employee accounts.

## Requirements

### Requirement: Internal-only super-admin identity

The system MUST allow platform super-admin accounts to authenticate through the same general login flow used by the product, but the account MUST be recognized as super-admin only from internally persisted data. Public registration or self-provisioning MUST NOT create a super-admin account.

#### Scenario: Super-admin logs in through the general login

- GIVEN an account marked internally as super-admin
- WHEN that account authenticates through the normal login entrypoint
- THEN the session is resolved as a super-admin session
- AND the user is routed to the platform console instead of an empresa dashboard

#### Scenario: Public signup does not create super-admins

- GIVEN a public user without internal super-admin provisioning
- WHEN the user creates or uses a regular company account
- THEN the resulting account is not treated as super-admin
- AND the user cannot access the platform console

### Requirement: Super-admin-only route protection

The platform console MUST reject any authenticated user that is not internally marked as super-admin, including regular empresa accounts and employee accounts.

#### Scenario: Empresa user tries to access owner console

- GIVEN an authenticated empresa user that is not a super-admin
- WHEN the user requests the platform console
- THEN the request is rejected or redirected away from the owner console

#### Scenario: Employee user tries to access owner console

- GIVEN an authenticated employee user that is not a super-admin
- WHEN the user requests the platform console
- THEN the request is rejected or redirected away from the owner console
